import type { ModuleInputs, ModuleOutputs, ModuleProcessor, ProcessorKey, SignalBuffer, SignalType, SimulationContext } from '../types';

function requireInput(inputs: ModuleInputs, port: string): SignalBuffer {
  const signal = inputs[port];
  if (!signal || signal.samples.length === 0) throw new Error(`Input ${port} is not connected to a valid signal.`);
  return signal;
}

function assertTimebase(a: SignalBuffer, b: SignalBuffer, label: string): void {
  if (a.samples.length !== b.samples.length || a.sampleRate !== b.sampleRate || a.startTime !== b.startTime) {
    throw new Error(`${label} inputs must share the simulation time base.`);
  }
}

function makeSignal(
  samples: Float64Array,
  context: SimulationContext,
  name: string,
  signalType: SignalType = 'analog',
  frequency?: number,
  phase?: number,
): SignalBuffer {
  return {
    samples,
    sampleRate: context.sampleRate,
    startTime: context.startTime,
    signalType,
    metadata: { name, unit: signalType === 'digital' ? 'logic V' : 'V', sourceModuleId: context.moduleId, frequency, phase },
  };
}

function constant(value: number, context: SimulationContext, name: string, signalType: SignalType = 'analog'): SignalBuffer {
  return makeSignal(new Float64Array(context.sampleCount).fill(value), context, name, signalType);
}

function sampleTone(frequency: number, amplitude: number, phase: number, context: SimulationContext, name: string, signalType: SignalType = 'analog'): SignalBuffer {
  if (!(frequency >= 0 && frequency < context.sampleRate / 2)) throw new Error(`${name} frequency ${frequency} Hz must be below Nyquist (${context.sampleRate / 2} Hz).`);
  const samples = new Float64Array(context.sampleCount);
  for (let n = 0; n < samples.length; n += 1) {
    const angle = 2 * Math.PI * frequency * (context.startTime + n / context.sampleRate) + phase;
    samples[n] = signalType === 'digital' ? (Math.sin(angle) >= 0 ? 5 : 0) : amplitude * Math.sin(angle);
  }
  return makeSignal(samples, context, name, signalType, frequency, phase);
}

const isHigh = (value: number) => value > 2.5;
/** Logic level on the first sample used to start edge detection. At absolute t = 0 the reference clocks begin with a rising edge on
 *  sample 0; in later (streaming) windows a clock that is already high on sample 0 must not invent an extra edge. */
function initialClockState(clock: SignalBuffer, context: SimulationContext): number {
  return context.startTime > 0 && isHigh(clock.samples[0]) ? 1 : 0;
}
/** ±5 V: the Buffer is an amplifier powered from the trainer's DC rails, so it clips (Experiment 2, Part "Buffer"). */
const AMPLIFIER_RAIL_V = 5;
/** A capacitively coupled (AC) socket blocks the DC component (Experiment 19: PN sequence patched to the Multiplier AC inputs). */
function acCouple(samples: Float64Array): Float64Array {
  // Estimate the DC level over a whole number of cycles (first to last rising zero crossing), so a sinewave that does not fit the
  // window an exact number of times is not given a false DC offset. Non-periodic signals (PN data, speech) fall back to that span's mean.
  let low = 0, high = samples.length;
  const span = toneSpan(samples);
  if (span) { low = Math.ceil(span.first); high = Math.floor(span.last); if (high - low < 2) { low = 0; high = samples.length; } }
  let mean = 0;
  for (let i = low; i < high; i += 1) mean += samples[i];
  mean /= (high - low) || 1;
  const coupled = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) coupled[i] = samples[i] - mean;
  return coupled;
}
/** First/last rising zero-crossing positions (fractional samples) and their count, relative to the window mean. */
function toneSpan(samples: Float64Array): { first: number; last: number; count: number } | null {
  let mean = 0;
  for (let i = 0; i < samples.length; i += 1) mean += samples[i];
  mean /= samples.length || 1;
  let first = -1, last = -1, count = 0;
  for (let n = 1; n < samples.length; n += 1) {
    const before = samples[n - 1] - mean, after = samples[n] - mean;
    if (before <= 0 && after > 0) {
      const position = n - 1 + (before === after ? 0 : -before / (after - before));
      if (first < 0) first = position;
      last = position; count += 1;
    }
  }
  return count >= 2 && last > first ? { first, last, count } : null;
}

const processVariableAdder: ModuleProcessor = (inputs, parameters, context) => {
  const a = requireInput(inputs, 'A');
  const b = requireInput(inputs, 'B');
  assertTimebase(a, b, 'Adder');
  const gainA = Number(parameters.gainA);
  const gainB = Number(parameters.gainB);
  if (![gainA, gainB].every(Number.isFinite) || gainA < 0 || gainA > 2 || gainB < 0 || gainB > 2) throw new Error('Adder gains must be between 0 and 2.');
  const samples = new Float64Array(context.sampleCount);
  for (let i = 0; i < samples.length; i += 1) samples[i] = -(gainA * a.samples[i] + gainB * b.samples[i]);
  return { 'GA+gB': makeSignal(samples, context, 'Inverting weighted sum') };
};

const processFixedAdder: ModuleProcessor = (inputs, _parameters, context) => {
  const noise = requireInput(inputs, 'NOISE');
  const signal = requireInput(inputs, 'SIGNAL');
  assertTimebase(noise, signal, 'Channel Adder');
  const samples = new Float64Array(context.sampleCount);
  for (let i = 0; i < samples.length; i += 1) samples[i] = noise.samples[i] + signal.samples[i];
  return { CHANNEL_OUT: makeSignal(samples, context, 'Channel signal + noise') };
};


const processMultiplier: ModuleProcessor = (inputs, _parameters, context) => {
  const axis = (dc: SignalBuffer | undefined, ac: SignalBuffer | undefined, label: string): Float64Array => {
    const present = [dc, ac].filter((signal): signal is SignalBuffer => Boolean(signal));
    if (!present.length) throw new Error(`Connect at least one signal to the ${label} axis.`);
    for (const signal of present.slice(1)) assertTimebase(present[0], signal, label);
    const sum = new Float64Array(context.sampleCount);
    if (dc) for (let i = 0; i < sum.length; i += 1) sum[i] += dc.samples[i];
    if (ac) { const coupled = acCouple(ac.samples); for (let i = 0; i < sum.length; i += 1) sum[i] += coupled[i]; }
    return sum;
  };
  let x: Float64Array;
  let y: Float64Array;
  if (context.moduleType === 'multiplier.four') {
    x = axis(inputs.X_DC, inputs.X_AC, 'X');
    y = axis(inputs.Y_DC, inputs.Y_AC, 'Y');
  } else {
    const xInput = requireInput(inputs, 'X_DC');
    const yInput = requireInput(inputs, 'Y_DC');
    assertTimebase(xInput, yInput, 'Multiplier');
    x = xInput.samples; y = yInput.samples;
  }
  const samples = new Float64Array(context.sampleCount);
  for (let i = 0; i < samples.length; i += 1) samples[i] = x[i] * y[i];
  return { kXY: makeSignal(samples, context, 'X × Y') };
};


const processTwinPulse: ModuleProcessor = (inputs, parameters, context) => {
  const clock = requireInput(inputs, 'CLK');
  const widthUs = Number(parameters.widthUs);
  const delayUs = Number(parameters.delayUs);
  if (!Number.isFinite(widthUs) || widthUs < 5 || widthUs > 40 || !Number.isFinite(delayUs) || delayUs < 50 || delayUs > 300) throw new Error('Pulse width must be 5–40 µs and delay 50–300 µs.');
  const q1 = new Float64Array(context.sampleCount);
  const q2 = new Float64Array(context.sampleCount);
  const width = Math.max(1, Math.round(widthUs * 1e-6 * context.sampleRate));
  const delay = Math.max(1, Math.round(delayUs * 1e-6 * context.sampleRate));
  let previous = initialClockState(clock, context);
  let lastEdge = -Infinity;
  for (let i = 0; i < clock.samples.length; i += 1) {
    const current = isHigh(clock.samples[i]) ? 1 : 0;
    if (current && !previous) lastEdge = i;
    if (i - lastEdge >= 0 && i - lastEdge < width) q1[i] = 5;
    if (i - lastEdge >= delay && i - lastEdge < delay + width) q2[i] = 5;
    previous = current;
  }
  return { Q1: makeSignal(q1, context, 'Twin pulse Q1', 'digital'), Q2: makeSignal(q2, context, 'Twin pulse Q2', 'digital') };
};


const processDualSwitch: ModuleProcessor = (inputs, _parameters, context) => {
  const outputs: ModuleOutputs = {};
  const control1 = inputs.CONTROL1;
  const control2 = inputs.CONTROL2;
  const in1 = inputs.IN1;
  const in2 = inputs.IN2;
  // Manual, Experiment 11 (Figures 2 and 4): IN 1 is gated by CONTROL 1, IN 2 by CONTROL 2, and the two gated signals are summed on OUT.
  // CONTROL 1 also clocks the sample-and-hold. A switch whose control is high passes its input; otherwise it is open (contributes 0 V).
  if (in1 || in2) {
    const reference = (in1 ?? in2)!;
    for (const signal of [in1, in2, control1, control2]) if (signal) assertTimebase(reference, signal, 'Analog switch');
    const out = new Float64Array(context.sampleCount);
    for (let i = 0; i < out.length; i += 1) {
      let value = 0;
      if (in1 && control1 && isHigh(control1.samples[i])) value += in1.samples[i];
      if (in2 && control2 && isHigh(control2.samples[i])) value += in2.samples[i];
      out[i] = value;
    }
    outputs.OUT = makeSignal(out, context, 'Dual analog switch output');
  }
  const holdInput = inputs['S&H_IN'];
  if (holdInput && control1) {
    assertTimebase(holdInput, control1, 'Sample and hold');
    const held = new Float64Array(context.sampleCount);
    let previous = initialClockState(control1, context);
    let value = holdInput.samples[0];
    for (let i = 0; i < held.length; i += 1) {
      const gate = isHigh(control1.samples[i]) ? 1 : 0;
      if (gate && !previous) value = holdInput.samples[i];
      held[i] = value;
      previous = gate;
    }
    outputs['S&H_OUT'] = makeSignal(held, context, 'Sample-and-hold output');
  }
  if (!Object.keys(outputs).length) throw new Error('Connect IN 1 and/or IN 2 (with their CONTROL inputs) for the switch, or S&H IN and CONTROL 1 for sample-and-hold.');
  return outputs;
};

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


const processNoise: ModuleProcessor = (_inputs, _parameters, context) => {
  let seed = 2166136261;
  for (const character of context.moduleId) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  const sampleOffset = Math.floor(context.startTime * context.sampleRate);
  const random = seededRandom(seed + sampleOffset);
  const white = new Float64Array(context.sampleCount);
  for (let i = 0; i < white.length; i += 2) {
    const u1 = Math.max(Number.EPSILON, random());
    const u2 = random();
    const radius = Math.sqrt(-2 * Math.log(u1));
    white[i] = radius * Math.cos(2 * Math.PI * u2);
    if (i + 1 < white.length) white[i + 1] = radius * Math.sin(2 * Math.PI * u2);
  }
  // Specification: white noise from 10 Hz to just under 240 kHz. Band-limit it, then normalise so the 0 dB tap is 1 V rms
  // (comparable to the 4 Vp-p, 1.41 V rms test sinewave, as the manual describes it).
  const base = butterworthLowpass(white, context.sampleRate, Math.min(240_000, context.sampleRate * 0.45), 8);
  let energy = 0;
  for (let i = 0; i < base.length; i += 1) energy += base[i] * base[i];
  const normaliser = energy > 0 ? 1 / Math.sqrt(energy / base.length) : 1;
  const makeTap = (scale: number, label: string) => {
    const samples = new Float64Array(base.length);
    for (let i = 0; i < base.length; i += 1) samples[i] = base[i] * normaliser * scale;
    return makeSignal(samples, context, `Noise ${label}`);
  };
  return { '0dB': makeTap(1, '0 dB'), '-6dB': makeTap(10 ** (-6 / 20), '−6 dB'), '-20dB': makeTap(0.1, '−20 dB') };
};


const processBuffer: ModuleProcessor = (inputs, parameters, context) => {
  const input = requireInput(inputs, 'IN');
  const gain = Number(parameters.gain);
  if (!Number.isFinite(gain) || gain < 0 || gain > 10) throw new Error('Buffer gain must be between 0 and 10.');
  const samples = new Float64Array(input.samples.length);
  for (let i = 0; i < samples.length; i += 1) samples[i] = Math.max(-AMPLIFIER_RAIL_V, Math.min(AMPLIFIER_RAIL_V, input.samples[i] * gain));
  return { OUT: makeSignal(samples, context, `Buffer ×${gain}`) };
};

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }
function lowpassCoefficients(sampleRate: number, cutoff: number, q: number): Biquad {
  const omega = 2 * Math.PI * Math.min(cutoff, sampleRate * 0.45) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: (1 - cosine) / (2 * a0), b1: (1 - cosine) / a0, b2: (1 - cosine) / (2 * a0), a1: -2 * cosine / a0, a2: (1 - alpha) / a0 };
}
function highpassCoefficients(sampleRate: number, cutoff: number, q: number): Biquad {
  const omega = 2 * Math.PI * Math.min(cutoff, sampleRate * 0.45) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: (1 + cosine) / (2 * a0), b1: -(1 + cosine) / a0, b2: (1 + cosine) / (2 * a0), a1: -2 * cosine / a0, a2: (1 - alpha) / a0 };
}

function applyBiquad(input: Float64Array, coefficients: Biquad): Float64Array {
  const output = new Float64Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  // Two passes: the first lets the filter settle on the (assumed repeating) window, the second produces the output. A hardware filter
  // has been running for a long time, so a window must not show the start-up transient of a filter that begins at rest.
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < input.length; i += 1) {
      const x0 = input[i];
      const y0 = coefficients.b0 * x0 + coefficients.b1 * x1 + coefficients.b2 * x2 - coefficients.a1 * y1 - coefficients.a2 * y2;
      output[i] = Number.isFinite(y0) ? y0 : 0;
      x2 = x1; x1 = x0; y2 = y1; y1 = output[i];
    }
  }
  return output;
}

function butterworthLowpass(input: Float64Array, sampleRate: number, cutoff: number, order: 1 | 2 | 8): Float64Array {
  let output = input;
  if (order === 1) {
    const alpha = 1 - Math.exp(-2 * Math.PI * Math.min(cutoff, sampleRate * 0.45) / sampleRate);
    const filtered = new Float64Array(input.length);
    let state = 0;
    for (let pass = 0; pass < 2; pass += 1) for (let i = 0; i < filtered.length; i += 1) { state += alpha * (input[i] - state); filtered[i] = state; }
    return filtered;
  }
  const qValues = order === 2 ? [Math.SQRT1_2] : [0.5098, 0.6013, 0.9, 2.5629];
  for (const q of qValues) output = applyBiquad(output, lowpassCoefficients(sampleRate, cutoff, q));
  return output;
}
const processLowpass: ModuleProcessor = (inputs, parameters, context) => {
  const input = requireInput(inputs, 'IN');
  let cutoff = 1600;
  let order: 1 | 2 | 8 = 2;
  let gain = 1;
  if (context.moduleType === 'filter.rc') { cutoff = 4000; order = 1; }
  if (context.moduleType === 'filter.tunable') { cutoff = Number(parameters.cutoffHz); order = 8; gain = Number(parameters.gain); }
  if (!Number.isFinite(cutoff) || cutoff <= 0 || cutoff >= context.sampleRate / 2) throw new Error(`Filter cutoff must be between 0 and Nyquist (${context.sampleRate / 2} Hz).`);
  if (!Number.isFinite(gain) || gain < 0 || gain > 2) throw new Error('Filter gain must be between 0 and 2.');
  const filtered = butterworthLowpass(input.samples, context.sampleRate, cutoff, order);
  for (let i = 0; i < filtered.length; i += 1) filtered[i] *= gain;
  const outputs: ModuleOutputs = { OUT: makeSignal(filtered, context, `${context.moduleType} · ${cutoff} Hz`) };
  if (context.moduleType === 'filter.tunable') {
    const monitorHz = cutoff * 100;
    if (monitorHz >= context.sampleRate / 2) throw new Error(`The ×100 cutoff monitor (${monitorHz} Hz) exceeds Nyquist; increase the project sample rate.`);
    outputs.fc_x100 = sampleTone(monitorHz, 0, 0, context, `fc monitor · ${monitorHz} Hz`, 'digital');
  }
  return outputs;
};

const processChannelBpf: ModuleProcessor = (inputs, _parameters, context) => {
  const input = requireInput(inputs, 'IN');
  const highpassed = applyBiquad(input.samples, highpassCoefficients(context.sampleRate, 88_000, Math.SQRT1_2));
  const band = applyBiquad(highpassed, lowpassCoefficients(context.sampleRate, 112_000, Math.SQRT1_2));
  return { OUT: makeSignal(band, context, 'Channel BPF · 100 kHz center') };
};


/** Frequency of the dominant tone from rising zero crossings (linear interpolation); null when the input has no oscillation. */
function estimateToneFrequency(samples: Float64Array, sampleRate: number): number | null {
  const span = toneSpan(samples);
  return span ? (span.count - 1) * sampleRate / (span.last - span.first) : null;
}
/** Phase lag (radians, 0…π) of the first-order all-pass y[n] = a·x[n] + x[n−1] − a·y[n−1] at angular frequency omega. */
function allpassLag(a: number, omega: number): number {
  const numeratorPhase = Math.atan2(-Math.sin(omega), a + Math.cos(omega));
  const denominatorPhase = Math.atan2(-a * Math.sin(omega), 1 + a * Math.cos(omega));
  let lag = -(numeratorPhase - denominatorPhase);
  while (lag < 0) lag += 2 * Math.PI;
  while (lag >= 2 * Math.PI) lag -= 2 * Math.PI;
  return lag;
}
const processPhaseShifter: ModuleProcessor = (inputs, parameters, context) => {
  const input = requireInput(inputs, 'IN');
  const degrees = Number(parameters.phaseDegrees);
  if (!Number.isFinite(degrees)) throw new Error('Phase must be a finite number.');
  let lag = Math.max(0, Math.min(180, degrees)) * Math.PI / 180;
  let sign = parameters.invert === 'invert' ? -1 : 1;
  if (lag >= Math.PI - 1e-9) { sign = -sign; lag = 0; }
  const samples = new Float64Array(input.samples.length);
  const frequency = estimateToneFrequency(input.samples, context.sampleRate);
  if (lag < 1e-9 || frequency === null || frequency >= context.sampleRate / 2) {
    for (let n = 0; n < samples.length; n += 1) samples[n] = sign * input.samples[n];
  } else {
    // The real module is an adjustable all-pass: constant gain, and a phase that depends on frequency. Choose the all-pass
    // coefficient so the lag at the signal's own frequency equals the panel setting (the module also auto-ranges to the input band).
    const omega = 2 * Math.PI * frequency / context.sampleRate;
    let low = -0.999999, high = 0.999999;
    for (let step = 0; step < 80; step += 1) {
      const middle = (low + high) / 2;
      if (allpassLag(middle, omega) > lag) low = middle; else high = middle;
    }
    const a = (low + high) / 2;
    let previousInput = 0, previousOutput = 0;
    for (let pass = 0; pass < 2; pass += 1) {
      for (let n = 0; n < samples.length; n += 1) {
        const x = input.samples[n];
        const y = a * x + previousInput - a * previousOutput;
        samples[n] = sign * y;
        previousInput = x; previousOutput = y;
      }
    }
  }
  return { OUT: makeSignal(samples, context, `Phase shifted · ${Math.round((lag * 180 / Math.PI) + (sign < 0 ? 180 : 0))}°`) };
};


const processComparator: ModuleProcessor = (inputs, _parameters, context) => {
  const ref = inputs.REF;
  const input = requireInput(inputs, 'IN');
  if (ref) assertTimebase(ref, input, 'Comparator');
  const samples = new Float64Array(context.sampleCount);
  for (let i = 0; i < samples.length; i += 1) samples[i] = input.samples[i] >= (ref ? ref.samples[i] : 0) ? 5 : 0;
  return { OUT: makeSignal(samples, context, 'Comparator logic', 'digital') };
};
const processRectifier: ModuleProcessor = (inputs, _parameters, context) => {
  const input = requireInput(inputs, 'IN');
  const samples = new Float64Array(input.samples.length);
  for (let i = 0; i < samples.length; i += 1) samples[i] = Math.abs(input.samples[i]);
  return { OUT: makeSignal(samples, context, 'Ideal full-wave rectified signal') };
};

const processDiodeEnvelope: ModuleProcessor = (inputs, _parameters, context) => {
  const input = requireInput(inputs, 'IN');
  const attack = 1 - Math.exp(-1 / (2e-6 * context.sampleRate));   // 2 µs charge through the diode
  const release = 1 - Math.exp(-1 / (60e-6 * context.sampleRate)); // 60 µs discharge: ≫ 10 µs carrier period, ≪ 0.5 ms message period
  const samples = new Float64Array(input.samples.length);
  let state = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < samples.length; i += 1) {
      const target = Math.max(0, input.samples[i]);
      state += (target > state ? attack : release) * (target - state);
      samples[i] = state;
    }
  }
  return { OUT: makeSignal(samples, context, 'Diode + RC envelope approximation') };
};

const processVariableDc: ModuleProcessor = (_inputs, parameters, context) => {
  const voltage = Number(parameters.voltage);
  if (!Number.isFinite(voltage) || voltage < -2.5 || voltage > 2.5) throw new Error('Variable DC must be between −2.5 and +2.5 V.');
  return { VDC: constant(voltage, context, `Variable DC · ${voltage.toFixed(2)} V`), '+5V': constant(5, context, '+5 V logic reference', 'digital') };
};
const processSpeech: ModuleProcessor = (_inputs, _parameters, context) => {
  const audio = context.externalInputs?.[context.moduleId];
  if (!audio?.samples.length) throw new Error('Enable the microphone and allow browser audio access to use the Speech module. No test waveform is substituted.');
  const samples = new Float64Array(context.sampleCount);
  for (let i = 0; i < samples.length; i += 1) {
    const sourceIndex = Math.min(audio.samples.length - 1, Math.floor(i * audio.sampleRate / context.sampleRate));
    samples[i] = audio.samples[sourceIndex] * 2;
  }
  const hp = applyBiquad(samples, highpassCoefficients(context.sampleRate, 300, Math.SQRT1_2));
  const voice = applyBiquad(hp, lowpassCoefficients(context.sampleRate, 3000, Math.SQRT1_2));
  return { OUT: makeSignal(voice, context, 'Live microphone · 300 Hz–3 kHz') };
};
const processXor: ModuleProcessor = (inputs, _parameters, context) => {
  const a = requireInput(inputs, 'A'), b = requireInput(inputs, 'B');
  assertTimebase(a, b, 'EXOR');
  const samples = new Float64Array(context.sampleCount);
  for (let i = 0; i < samples.length; i += 1) samples[i] = ((a.samples[i] > 2.5) !== (b.samples[i] > 2.5)) ? 5 : 0;
  return { A_XOR_B: makeSignal(samples, context, 'A ⊕ B', 'digital') };
};


const processVco: ModuleProcessor = (inputs, parameters, context) => {
  const range = String(parameters.range);
  const control = Number(parameters.frequencyControl);
  const gain = Number(parameters.gain);
  if (!Number.isFinite(control) || control < 0 || control > 1 || !Number.isFinite(gain) || gain < 0 || gain > 2) throw new Error('VCO control/gain is outside its physical range.');
  const high = range === 'high';
  const lowHz = high ? 60_000 : 1_000;
  const spanHz = high ? 80_000 : 16_000;
  const baseFrequency = lowHz + control * spanHz;
  // Manual, Experiments 9, 10 and 21: GAIN adjusts the VCO's sensitivity (Δ Hz per volt on VCO INPUT), not the output amplitude.
  // Fully clockwise on LO range gives 2.5 kHz/V (10 kHz → 15 kHz for +2 V). The HI range is scaled to the ≈5 kHz/V ceiling quoted in Experiment 21.
  const sensitivityHzPerVolt = (gain / 2) * (high ? 5_000 : 2_500);
  const cv = inputs.VCO_INPUT;
  if (cv) assertTimebase(cv, constant(0, context, 'timebase'), 'VCO');
  const sine = new Float64Array(context.sampleCount);
  const digitalOut = new Float64Array(context.sampleCount);
  const amplitude = 2; // 4 Vp-p, the trainer's nominal analog level
  let phase = 0;
  for (let i = 0; i < sine.length; i += 1) {
    const voltage = cv?.samples[i] ?? 0;
    const instantaneous = Math.max(100, baseFrequency + voltage * sensitivityHzPerVolt);
    if (instantaneous >= context.sampleRate / 2) throw new Error(`VCO frequency ${Math.round(instantaneous)} Hz exceeds Nyquist.`);
    sine[i] = amplitude * Math.sin(phase);
    digitalOut[i] = sine[i] >= 0 ? 5 : 0;
    phase += 2 * Math.PI * instantaneous / context.sampleRate;
    if (phase >= 2 * Math.PI) phase -= 2 * Math.PI;
  }
  return { SINE: makeSignal(sine, context, `VCO · ${Math.round(baseFrequency)} Hz`, 'analog', baseFrequency), DIGITAL: makeSignal(digitalOut, context, `VCO logic · ${Math.round(baseFrequency)} Hz`, 'digital', baseFrequency) };
};

function lfsrSequence(length: 5 | 8): number[] {
  let state = length === 5 ? 0b11111 : 0b11111111;
  const sequence: number[] = [];
  const limit = length === 5 ? 31 : 255;
  for (let i = 0; i < limit; i += 1) {
    sequence.push(state & 1);
    const feedback = length === 5 ? ((state >> 0) ^ (state >> 2)) & 1 : ((state >> 0) ^ (state >> 2) ^ (state >> 3) ^ (state >> 4)) & 1;
    state = (state >> 1) | (feedback << (length - 1));
    if (state === 0) state = (1 << length) - 1;
  }
  return sequence;
}

const onesInFirst = (sequence: number[], count: number): number => {
  let ones = 0;
  for (let i = 0; i < count; i += 1) ones += sequence[i % sequence.length];
  return ones;
};
const processSequence: ModuleProcessor = (inputs, parameters, context) => {
  const clock = requireInput(inputs, 'CLK');
  const xSequence = lfsrSequence(5), ySequence = lfsrSequence(8);
  const x = new Float64Array(context.sampleCount), y = new Float64Array(context.sampleCount);
  const sync = new Float64Array(context.sampleCount), line = new Float64Array(context.sampleCount);
  const mode = String(parameters.lineCode);
  // Streaming windows: continue the sequence from the clock edges that happened before this window (periodic clocks only).
  const clockFrequency = clock.metadata.frequency;
  let bitIndex = context.startTime > 0 && clockFrequency ? Math.ceil(context.startTime * clockFrequency - 1e-9) - 1 : -1;
  let previousClock = initialClockState(clock, context);
  let nrzm = -1, amiPolarity = -1;
  if (bitIndex >= 0 && onesInFirst(xSequence, bitIndex + 1) % 2 === 1) { nrzm = 1; amiPolarity = 1; }
  for (let i = 0; i < context.sampleCount; i += 1) {
    const clockBit = isHigh(clock.samples[i]) ? 1 : 0;
    if (clockBit && !previousClock) {
      bitIndex += 1;
      if (xSequence[bitIndex % xSequence.length]) { nrzm *= -1; amiPolarity *= -1; }
    }
    previousClock = clockBit;
    if (bitIndex < 0) continue; // idle until the first clock edge
    const xi = xSequence[bitIndex % xSequence.length];
    const yi = ySequence[bitIndex % ySequence.length];
    x[i] = xi * 5; y[i] = yi * 5;
    sync[i] = bitIndex % xSequence.length === 0 ? 5 : 0; // SYNC marks the first bit of the X sequence for one full bit period
    const firstHalf = clockBit === 1; // clock high = first half of the bit cell
    switch (mode) {
      case 'biphase': line[i] = (xi === (firstHalf ? 0 : 1)) ? 1 : -1; break;
      case 'rz-ami': line[i] = xi && firstHalf ? amiPolarity : 0; break;
      case 'nrz-m': line[i] = nrzm; break;
      default: line[i] = xi ? 1 : -1;
    }
  }
  return { X: makeSignal(x, context, 'Sequence X · PRBS31', 'digital'), Y: makeSignal(y, context, 'Sequence Y · PRBS255', 'digital'), SYNC: makeSignal(sync, context, 'Sequence sync', 'digital'), LINE_CODE: makeSignal(line, context, `Line code · ${mode}`) };
};


const processDivider: ModuleProcessor = (inputs, parameters, context) => {
  const input = requireInput(inputs, 'IN');
  const ratio = Number(parameters.ratio);
  if (![1, 2, 4, 8].includes(ratio)) throw new Error('Divider ratio must be ÷1, ÷2, ÷4 or ÷8.');
  if (ratio === 1) return { OUT: makeSignal(input.samples.slice(), context, 'Divider ÷1', 'digital', input.metadata.frequency) };
  const samples = new Float64Array(context.sampleCount);
  const edgesPerToggle = ratio / 2;
  let previous = initialClockState(input, context), edges = 0, output = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const current = isHigh(input.samples[i]) ? 1 : 0;
    if (current && !previous) { edges += 1; if (edges >= edgesPerToggle) { output = output ? 0 : 5; edges = 0; } }
    samples[i] = output; previous = current;
  }
  return { OUT: makeSignal(samples, context, `Divider ÷${ratio}`, 'digital', input.metadata.frequency ? input.metadata.frequency / ratio : undefined) };
};


const processPcmEncoder: ModuleProcessor = (inputs, parameters, context) => {
  const input1 = requireInput(inputs, 'INPUT1'), clock = requireInput(inputs, 'CLK');
  const input2 = inputs.INPUT2;
  if (input2) assertTimebase(input1, input2, 'PCM encoder');
  assertTimebase(input1, clock, 'PCM encoder');
  const data = new Float64Array(context.sampleCount), fs = new Float64Array(context.sampleCount);
  const tdm = String(parameters.mode) === 'tdm';
  let previousClock = initialClockState(clock, context), bitInFrame = 0, word = 128, frame = 0, bitLevel = 0, frameSync = 0;
  for (let i = 0; i < data.length; i += 1) {
    const current = isHigh(clock.samples[i]) ? 1 : 0;
    if (current && !previousClock) {
      if (bitInFrame === 0) {
        // The codec samples once per frame: −2 V … +2 V maps onto 00000000 … 11111111.
        const source = tdm && frame % 2 === 1 && input2 ? input2 : input1;
        word = Math.max(0, Math.min(255, Math.round((source.samples[i] + 2) / 4 * 255)));
        frame += 1;
      }
      bitLevel = (word >> (7 - bitInFrame)) & 1;          // MSB (bit-7) first
      frameSync = bitInFrame === 7 ? 5 : 0;               // FS is high while bit-0 is on PCM DATA
      bitInFrame = (bitInFrame + 1) % 8;
    }
    data[i] = bitLevel ? 5 : 0;                           // each bit is held for its whole clock period
    fs[i] = frameSync;
    previousClock = current;
  }
  return { PCM_DATA: makeSignal(data, context, '8-bit serial PCM', 'digital'), FS: makeSignal(fs, context, 'PCM frame sync', 'digital') };
};


const processPcmDecoder: ModuleProcessor = (inputs, _parameters, context) => {
  const fs = requireInput(inputs, 'FS'), data = requireInput(inputs, 'PCM_DATA'), clock = requireInput(inputs, 'CLK');
  assertTimebase(fs, data, 'PCM decoder'); assertTimebase(fs, clock, 'PCM decoder');
  const output = new Float64Array(context.sampleCount), output2 = new Float64Array(context.sampleCount);
  let previousClock = initialClockState(clock, context), word = 0, value = 0, value2 = 0, words = 0;
  for (let i = 0; i < output.length; i += 1) {
    const current = isHigh(clock.samples[i]) ? 1 : 0;
    if (!current && previousClock) {
      word = ((word << 1) | (isHigh(data.samples[i]) ? 1 : 0)) & 255;
      if (isHigh(fs.samples[i])) {                         // FS high = this is bit-0, the word is complete
        const decoded = (word / 255) * 4 - 2;              // 00000000 → −2 V, 11111111 → +2 V
        value = decoded;
        if (words % 2 === 1) value2 = decoded;
        words += 1;
      }
    }
    output[i] = value; output2[i] = value2;
    previousClock = current;
  }
  return { OUTPUT: makeSignal(output, context, 'PCM reconstruction'), OUTPUT2: makeSignal(output2, context, 'PCM TDM channel 2') };
};


const processMasterSignals: ModuleProcessor = (_inputs, _parameters, context) => ({
  '100kHz_SINE': sampleTone(100_000, 2, 0, context, '100 kHz sine'),
  '100kHz_COS': sampleTone(100_000, 2, Math.PI / 2, context, '100 kHz cosine'),
  '100kHz_DIGITAL': sampleTone(100_000, 0, 0, context, '100 kHz digital', 'digital'),
  '8kHz_DIGITAL': sampleTone(100_000 / 12, 0, 0, context, '8.333 kHz digital', 'digital'),
  '2kHz_DIGITAL': sampleTone(100_000 / 48, 0, 0, context, '2.083 kHz digital', 'digital'),
  '2kHz_SINE': sampleTone(100_000 / 48, 2, 0, context, '2.083 kHz sine'),
});


const processSerialToParallel: ModuleProcessor = (inputs, _parameters, context) => {
  const serial = requireInput(inputs, 'SERIAL'), clock = requireInput(inputs, 'CLK');
  assertTimebase(serial, clock, 'Serial-to-parallel');
  const x1 = new Float64Array(context.sampleCount), x2 = new Float64Array(context.sampleCount);
  let previous = initialClockState(clock, context), first = -1, second = -1;
  for (let i = 0; i < x1.length; i += 1) {
    const current = isHigh(clock.samples[i]) ? 1 : 0;
    // Experiment 18 clocks this block from the Divider's ÷2 output: one bit of every pair is latched on each clock edge, so X1 carries
    // the even bits and X2 the odd bits, each at half the serial bit rate and offset by one bit period (the manual's "OQPSK").
    const decoded = isHigh(serial.samples[i]) ? 1 : -1;
    if (current && !previous) first = decoded;
    else if (!current && previous) second = decoded;
    x1[i] = first; x2[i] = second; previous = current;
  }
  return { X1: makeSignal(x1, context, 'Serial-to-parallel X1 (even bits)'), X2: makeSignal(x2, context, 'Serial-to-parallel X2 (odd bits)') };
};

export const processorRegistry: Record<ProcessorKey, ModuleProcessor> = {
  adderVariable: processVariableAdder,
  adderFixed: processFixedAdder,
  multiplier: processMultiplier,
  twinPulse: processTwinPulse,
  dualSwitch: processDualSwitch,
  noise: processNoise,
  buffer: processBuffer,
  lowpass: processLowpass,
  channelBpf: processChannelBpf,
  phaseShifter: processPhaseShifter,
  comparator: processComparator,
  rectifier: processRectifier,
  diodeEnvelope: processDiodeEnvelope,
  variableDc: processVariableDc,
  speech: processSpeech,
  xor: processXor,
  vco: processVco,
  sequence: processSequence,
  divider: processDivider,
  pcmEncoder: processPcmEncoder,
  masterSignals: processMasterSignals,
  serialToParallel: processSerialToParallel,
  pcmDecoder: processPcmDecoder,
};

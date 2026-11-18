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

function addSignals(signals: (SignalBuffer | undefined)[], context: SimulationContext, label: string): Float64Array {
  const present = signals.filter((signal): signal is SignalBuffer => Boolean(signal));
  if (!present.length) throw new Error(`Connect at least one signal to the ${label} axis.`);
  const reference = present[0];
  for (const signal of present.slice(1)) assertTimebase(reference, signal, label);
  const sum = new Float64Array(context.sampleCount);
  for (const signal of present) for (let i = 0; i < sum.length; i += 1) sum[i] += signal.samples[i];
  return sum;
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
  const x = context.moduleType === 'multiplier.four'
    ? addSignals([inputs.X_DC, inputs.X_AC], context, 'X')
    : requireInput(inputs, 'X_DC').samples;
  const y = context.moduleType === 'multiplier.four'
    ? addSignals([inputs.Y_DC, inputs.Y_AC], context, 'Y')
    : requireInput(inputs, 'Y_DC').samples;
  if (context.moduleType !== 'multiplier.four') assertTimebase(requireInput(inputs, 'X_DC'), requireInput(inputs, 'Y_DC'), 'Multiplier');
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
  let previous = 0;
  let lastEdge = -Infinity;
  for (let i = 0; i < clock.samples.length; i += 1) {
    const current = clock.samples[i] > 2.5 ? 1 : 0;
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
  if (inputs.IN1 && inputs.IN2 && control1 && control2) {
    [inputs.IN1, inputs.IN2, control1, control2].forEach((signal) => assertTimebase(inputs.IN1!, signal, 'Analog switch'));
    const selected = new Float64Array(context.sampleCount);
    for (let i = 0; i < selected.length; i += 1) {
      const c1 = control1.samples[i] > 2.5;
      const c2 = control2.samples[i] > 2.5;
      selected[i] = c1 === c2 ? 0 : c1 ? inputs.IN1.samples[i] : inputs.IN2.samples[i];
    }
    outputs.OUT = makeSignal(selected, context, 'Dual analog switch output');
  }
  if (inputs['S&H_IN'] && control1) {
    assertTimebase(inputs['S&H_IN'], control1, 'Sample and hold');
    const held = new Float64Array(context.sampleCount);
    let previous = control1.samples[0] > 2.5;
    let value = 0;
    for (let i = 0; i < held.length; i += 1) {
      const gate = control1.samples[i] > 2.5;
      if (gate && !previous) value = inputs['S&H_IN'].samples[i];
      held[i] = value;
      previous = gate;
    }
    outputs['S&H_OUT'] = makeSignal(held, context, 'Sample-and-hold output');
  }
  if (!Object.keys(outputs).length) throw new Error('Connect IN1/IN2 and both controls for the switch, or S&H_IN and CONTROL1 for sample-and-hold.');
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
  const base = new Float64Array(context.sampleCount);
  for (let i = 0; i < base.length; i += 2) {
    const u1 = Math.max(Number.EPSILON, random());
    const u2 = random();
    const radius = Math.sqrt(-2 * Math.log(u1));
    base[i] = radius * Math.cos(2 * Math.PI * u2);
    if (i + 1 < base.length) base[i + 1] = radius * Math.sin(2 * Math.PI * u2);
  }
  const makeTap = (scale: number, label: string) => {
    const samples = new Float64Array(base.length);
    for (let i = 0; i < base.length; i += 1) samples[i] = base[i] * scale;
    return makeSignal(samples, context, `Noise ${label}`);
  };
  return { '0dB': makeTap(1, '0 dB'), '-6dB': makeTap(10 ** (-6 / 20), '−6 dB'), '-20dB': makeTap(0.1, '−20 dB') };
};

const processBuffer: ModuleProcessor = (inputs, parameters, context) => {
  const input = requireInput(inputs, 'IN');
  const gain = Number(parameters.gain);
  if (!Number.isFinite(gain) || gain < 0 || gain > 10) throw new Error('Buffer gain must be between 0 and 10.');
  const samples = new Float64Array(input.samples.length);
  for (let i = 0; i < samples.length; i += 1) samples[i] = input.samples[i] * gain;
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
  for (let i = 0; i < input.length; i += 1) {
    const x0 = input[i];
    const y0 = coefficients.b0 * x0 + coefficients.b1 * x1 + coefficients.b2 * x2 - coefficients.a1 * y1 - coefficients.a2 * y2;
    output[i] = Number.isFinite(y0) ? y0 : 0;
    x2 = x1; x1 = x0; y2 = y1; y1 = output[i];
  }
  return output;
}
function butterworthLowpass(input: Float64Array, sampleRate: number, cutoff: number, order: 1 | 2 | 8): Float64Array {
  let output = input;
  if (order === 1) {
    const alpha = 1 - Math.exp(-2 * Math.PI * Math.min(cutoff, sampleRate * 0.45) / sampleRate);
    const filtered = new Float64Array(input.length);
    let state = 0;
    for (let i = 0; i < filtered.length; i += 1) { state += alpha * (input[i] - state); filtered[i] = state; }
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
  if (context.moduleType === 'filter.rc') { cutoff = 1000; order = 1; }
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

const processPhaseShifter: ModuleProcessor = (inputs, parameters, context) => {
  const input = requireInput(inputs, 'IN');
  let phase = Number(parameters.phaseDegrees) * Math.PI / 180;
  if (!Number.isFinite(phase)) throw new Error('Phase must be a finite number.');
  if (parameters.invert === 'invert') phase += Math.PI;
  const taps = 63;
  const middle = (taps - 1) / 2;
  const hilbertKernel = new Float64Array(taps);
  for (let k = 0; k < taps; k += 1) {
    const offset = k - middle;
    if (offset !== 0 && Math.abs(offset) % 2 === 1) {
      const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * k / (taps - 1));
      hilbertKernel[k] = 2 / (Math.PI * offset) * window;
    }
  }
  const samples = new Float64Array(context.sampleCount);
  const cos = Math.cos(phase), sin = Math.sin(phase);
  for (let n = 0; n < samples.length; n += 1) {
    let quadrature = 0;
    for (let k = 0; k < taps; k += 1) {
      const sourceIndex = n - (k - middle);
      if (sourceIndex >= 0 && sourceIndex < input.samples.length) quadrature += hilbertKernel[k] * input.samples[sourceIndex];
    }
    samples[n] = cos * input.samples[n] + sin * quadrature;
  }
  return { OUT: makeSignal(samples, context, `Phase shifted · ${Math.round(phase * 180 / Math.PI)}°`) };
};

const processComparator: ModuleProcessor = (inputs, _parameters, context) => {
  const ref = requireInput(inputs, 'REF');
  const input = requireInput(inputs, 'IN');
  assertTimebase(ref, input, 'Comparator');
  const samples = new Float64Array(context.sampleCount);
  for (let i = 0; i < samples.length; i += 1) samples[i] = input.samples[i] >= ref.samples[i] ? 5 : 0;
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
  const attack = 1 - Math.exp(-2 * Math.PI * 1200 / context.sampleRate);
  const release = 1 - Math.exp(-2 * Math.PI * 80 / context.sampleRate);
  const samples = new Float64Array(input.samples.length);
  let state = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const target = Math.max(0, input.samples[i]);
    state += (target > state ? attack : release) * (target - state);
    samples[i] = state;
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
  const cv = inputs.VCO_INPUT;
  if (cv) assertTimebase(cv, constant(0, context, 'timebase'), 'VCO');
  const sine = new Float64Array(context.sampleCount);
  const digitalOut = new Float64Array(context.sampleCount);
  let phase = 0;
  for (let i = 0; i < sine.length; i += 1) {
    const voltage = cv?.samples[i] ?? 0;
    const instantaneous = Math.max(100, baseFrequency + voltage * (high ? 10_000 : 2_000));
    if (instantaneous >= context.sampleRate / 2) throw new Error(`VCO frequency ${Math.round(instantaneous)} Hz exceeds Nyquist.`);
    sine[i] = gain * Math.sin(phase);
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
const processSequence: ModuleProcessor = (inputs, parameters, context) => {
  const clock = requireInput(inputs, 'CLK');
  const xSequence = lfsrSequence(5), ySequence = lfsrSequence(8);
  const x = new Float64Array(context.sampleCount), y = new Float64Array(context.sampleCount);
  const sync = new Float64Array(context.sampleCount), line = new Float64Array(context.sampleCount);
  const mode = String(parameters.lineCode);
  let previousClock = 0, bitIndex = -1, samplesInBit = 0, nrzm = -1, amiPolarity = -1;
  let lastBit = 0;
  for (let i = 0; i < context.sampleCount; i += 1) {
    const clockBit = clock.samples[i] > 2.5 ? 1 : 0;
    if (clockBit && !previousClock) { bitIndex += 1; samplesInBit = 0; lastBit = xSequence[bitIndex % xSequence.length]; if (lastBit) { nrzm *= -1; amiPolarity *= -1; } }
    const xi = bitIndex < 0 ? xSequence[0] : xSequence[bitIndex % xSequence.length];
    const yi = bitIndex < 0 ? ySequence[0] : ySequence[bitIndex % ySequence.length];
    x[i] = xi * 5; y[i] = yi * 5; sync[i] = bitIndex >= 0 && bitIndex % xSequence.length === 0 && samplesInBit < 1 ? 5 : 0;
    const bitSamples = Math.max(1, context.sampleRate / (clock.metadata.frequency ?? 8_333));
    const half = samplesInBit < bitSamples / 2;
    switch (mode) {
      case 'biphase': line[i] = (xi === (half ? 0 : 1)) ? 1 : -1; break;
      case 'rz-ami': line[i] = xi && half ? amiPolarity : 0; break;
      case 'nrz-m': line[i] = nrzm; break;
      default: line[i] = xi ? 1 : -1;
    }
    samplesInBit += 1;
    previousClock = clockBit;
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
  let previous = 0, edges = 0, output = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const current = input.samples[i] > 2.5 ? 1 : 0;
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
  let previousClock = 0, bitInFrame = 0, word = 128, frame = 0;
  for (let i = 0; i < data.length; i += 1) {
    const current = clock.samples[i] > 2.5 ? 1 : 0;
    if (current && !previousClock) {
      if (bitInFrame === 0) {
        const source = String(parameters.mode) === 'tdm' && frame % 2 === 1 && input2 ? input2 : input1;
        const quantized = Math.max(0, Math.min(255, Math.round((source.samples[i] + 2) / 4 * 255)));
        word = quantized; fs[i] = 5; frame += 1;
      }
      const bit = (word >> (7 - bitInFrame)) & 1;
      data[i] = bit ? 5 : 0;
      bitInFrame = (bitInFrame + 1) % 8;
    }
    previousClock = current;
  }
  return { PCM_DATA: makeSignal(data, context, '8-bit serial PCM', 'digital'), FS: makeSignal(fs, context, 'PCM frame sync', 'digital') };
};

const processPcmDecoder: ModuleProcessor = (inputs, _parameters, context) => {
  const fs = requireInput(inputs, 'FS'), data = requireInput(inputs, 'PCM_DATA'), clock = requireInput(inputs, 'CLK');
  assertTimebase(fs, data, 'PCM decoder'); assertTimebase(fs, clock, 'PCM decoder');
  const output = new Float64Array(context.sampleCount), output2 = new Float64Array(context.sampleCount);
  let previousClock = 0, bitCount = 0, word = 0, value = 0, frame = 0;
  for (let i = 0; i < output.length; i += 1) {
    const current = clock.samples[i] > 2.5 ? 1 : 0;
    if (current && !previousClock) {
      if (fs.samples[i] > 2.5) { bitCount = 0; word = 0; }
      if (bitCount < 8) {
        word = ((word << 1) | (data.samples[i] > 2.5 ? 1 : 0)) & 255;
        bitCount += 1;
        if (bitCount === 8) { value = (word / 255) * 4 - 2; frame += 1; }
      }
    }
    output[i] = value;
    output2[i] = frame % 2 === 0 ? value : 0;
    previousClock = current;
  }
  return { OUTPUT: makeSignal(output, context, 'PCM reconstruction'), OUTPUT2: makeSignal(output2, context, 'PCM TDM channel 2') };
};

const processMasterSignals: ModuleProcessor = (_inputs, _parameters, context) => ({
  '100kHz_SINE': sampleTone(100_000, 2, 0, context, '100 kHz sine'),
  '100kHz_COS': sampleTone(100_000, 2, Math.PI / 2, context, '100 kHz cosine'),
  '100kHz_DIGITAL': sampleTone(100_000, 0, 0, context, '100 kHz digital', 'digital'),
  '8kHz_DIGITAL': sampleTone(8_333, 0, 0, context, '8.333 kHz digital', 'digital'),
  '2kHz_DIGITAL': sampleTone(2_083, 0, 0, context, '2.083 kHz digital', 'digital'),
  '2kHz_SINE': sampleTone(2_083, 2, 0, context, '2.083 kHz sine'),
});

const processSerialToParallel: ModuleProcessor = (inputs, _parameters, context) => {
  const serial = requireInput(inputs, 'SERIAL'), clock = requireInput(inputs, 'CLK');
  assertTimebase(serial, clock, 'Serial-to-parallel');
  const x1 = new Float64Array(context.sampleCount), x2 = new Float64Array(context.sampleCount);
  let previous = 0, bitNumber = 0, first = -1, second = -1;
  for (let i = 0; i < x1.length; i += 1) {
    const current = clock.samples[i] > 2.5 ? 1 : 0;
    if (current && !previous) {
      const decoded = serial.samples[i] > 2.5 ? 1 : -1;
      if (bitNumber % 2 === 0) first = decoded; else second = decoded;
      bitNumber += 1;
    }
    x1[i] = first; x2[i] = second; previous = current;
  }
  return { X1: makeSignal(x1, context, 'Serial-to-parallel X1'), X2: makeSignal(x2, context, 'Serial-to-parallel X2') };
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

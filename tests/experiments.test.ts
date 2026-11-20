import { describe, expect, it } from 'vitest';
import { calculateSpectrum } from '../src/engine/fft';
import { measureSignal } from '../src/engine/measurements';
import { simulateProject } from '../src/engine/simulation';
import { validateConnection } from '../src/engine/graph';
import { createProject as createFullProject } from '../src/project/projectFormat';
const createProject = () => { const project = createFullProject(); project.settings.sampleCount = 16_384; return project; };
import { outputKey, socketId } from '../src/types';
import type { Connection, Project, SignalBuffer } from '../src/types';

let leads = 0;
function wire(project: Project, from: string, fromPort: string, to: string, toPort: string) {
  const check = validateConnection(project, from, fromPort, to, toPort);
  if (!check.ok) throw new Error(check.reason);
  leads += 1;
  const edge: Connection = { id: `e${leads}`, sourceModuleId: from, sourcePort: fromPort, targetModuleId: to, targetPort: toPort, sourceSocketId: socketId(from, fromPort), targetSocketId: socketId(to, toPort), color: 'red', routing: [], state: 'active' };
  project.connections.push(edge);
}
const set = (project: Project, id: string, key: string, value: number | string) => { project.modules.find((m) => m.id === id)!.parameters[key] = value; };
const run = (project: Project) => {
  const result = simulateProject(project);
  expect(result.errors).toEqual({});
  return (id: string, port: string): SignalBuffer => result.outputs[outputKey(id, port)];
};
const M = 'bottom.masterSignals';
const amplitudeAt = (signal: SignalBuffer, hz: number) => calculateSpectrum(signal, 'hann')
  .filter((bin) => Math.abs(Math.abs(bin.frequency) - hz) < 700).reduce((best, bin) => Math.max(best, bin.magnitude * 2), 0);
const mean = (a: Float64Array, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i += 1) s += a[i]; return s / (to - from); };
const rms = (a: Float64Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

/** DSB-SC modulator on the upper multiplier, product detector on the lower multiplier + Tuneable LPF (Experiments 5 and 7). */
function dsbscLink(localPhase?: number) {
  const p = createProject();
  wire(p, M, '2kHz_SINE', 'top.multiplier.upper', 'X_DC');
  wire(p, M, '100kHz_SINE', 'top.multiplier.upper', 'Y_DC');
  wire(p, 'top.multiplier.upper', 'kXY', 'bottom.multiplier', 'X_DC');
  if (localPhase === undefined) wire(p, M, '100kHz_SINE', 'bottom.multiplier', 'Y_DC');
  else {
    wire(p, M, '100kHz_SINE', 'top.phaseShifter', 'IN');
    wire(p, 'top.phaseShifter', 'OUT', 'bottom.multiplier', 'Y_DC');
    set(p, 'top.phaseShifter', 'phaseDegrees', localPhase);
  }
  wire(p, 'bottom.multiplier', 'kXY', 'top.tunableLpf', 'IN');
  set(p, 'top.tunableLpf', 'cutoffHz', 6000);
  return p;
}

describe('Experiments 4–5: AM and DSB-SC generation', () => {
  it('AM = (DC + message) × carrier gives carrier plus two sidebands with m = 0.5 (Exp. 4)', () => {
    const p = createProject();
    wire(p, M, '2kHz_SINE', 'top.adder', 'A');
    wire(p, 'bottom.variableDcv', 'VDC', 'top.adder', 'B');
    set(p, 'top.adder', 'gainA', 0.25);   // 1 Vp-p message (inverting adder)
    set(p, 'top.adder', 'gainB', 1);
    set(p, 'bottom.variableDcv', 'voltage', -1); // inverted by the adder → +1 V DC, as in the manual (VDC "almost fully anti-clockwise")
    wire(p, 'top.adder', 'GA+gB', 'top.multiplier.upper', 'X_DC');
    wire(p, M, '100kHz_SINE', 'top.multiplier.upper', 'Y_DC');
    const out = run(p)('top.multiplier.upper', 'kXY');
    const carrier = amplitudeAt(out, 100_000), side = amplitudeAt(out, 102_083);
    expect(carrier).toBeGreaterThan(1.8);
    expect(side / carrier).toBeGreaterThan(0.2);   // m/2 = 0.25
    expect(side / carrier).toBeLessThan(0.3);
  });
  it('DSB-SC has both sidebands and no carrier (Exp. 5)', () => {
    const out = run(dsbscLink())('top.multiplier.upper', 'kXY');
    expect(amplitudeAt(out, 97_917)).toBeGreaterThan(1.6);   // Hann scalloping can cost up to 1.4 dB
    expect(amplitudeAt(out, 102_083)).toBeGreaterThan(1.6);
    expect(amplitudeAt(out, 100_000)).toBeLessThan(0.15);
  });
});

describe('Experiment 7: product detector', () => {
  it('recovers the 2.083 kHz message (4 V peak) and rejects the 200 kHz term', () => {
    const out = run(dsbscLink())('top.tunableLpf', 'OUT');
    expect(amplitudeAt(out, 2_083)).toBeGreaterThan(3.4);
    expect(amplitudeAt(out, 2_083)).toBeLessThan(4.4);
    expect(amplitudeAt(out, 200_000)).toBeLessThan(0.05);
  });
  it('a carrier phase error scales the output by cos(error): 60° halves it, 90° nulls it', () => {
    const full = amplitudeAt(run(dsbscLink())('top.tunableLpf', 'OUT'), 2_083);
    const sixty = amplitudeAt(run(dsbscLink(60))('top.tunableLpf', 'OUT'), 2_083);
    const ninety = amplitudeAt(run(dsbscLink(90))('top.tunableLpf', 'OUT'), 2_083);
    expect(sixty / full).toBeGreaterThan(0.42);
    expect(sixty / full).toBeLessThan(0.58);
    expect(ninety / full).toBeLessThan(0.08);
  });
});

describe('Phase Shifter', () => {
  it('shifts a 2 kHz message by the panel angle with unchanged amplitude (Exp. 3, 8)', () => {
    for (const degrees of [30, 90, 150]) {
      const p = createProject();
      wire(p, M, '2kHz_SINE', 'top.phaseShifter', 'IN');
      set(p, 'top.phaseShifter', 'phaseDegrees', degrees);
      const get = run(p);
      const input = get(M, '2kHz_SINE').samples, out = get('top.phaseShifter', 'OUT').samples;
      // correlate over whole cycles in the settled middle of the window
      const w = 2 * Math.PI * (100_000 / 48) / 8_000_000;
      let s = 0, c = 0, si = 0, ci = 0;
      for (let n = 4000; n < 12000; n += 1) { s += out[n] * Math.sin(w * n); c += out[n] * Math.cos(w * n); si += input[n] * Math.sin(w * n); ci += input[n] * Math.cos(w * n); }
      const lag = (Math.atan2(s, c) - Math.atan2(si, ci)) * 180 / Math.PI;
      expect(((lag % 360) + 360) % 360).toBeCloseTo(degrees, -1);
      expect(Math.hypot(s, c) / Math.hypot(si, ci)).toBeCloseTo(1, 1);
    }
  });
});

describe('Experiment 11: sampling', () => {
  it('Dual Analog Switch gates IN 2 with CONTROL 2 (natural sampling)', () => {
    const p = createProject();
    wire(p, M, '2kHz_SINE', 'top.analogSwitch', 'IN2');
    wire(p, M, '8kHz_DIGITAL', 'top.analogSwitch', 'CONTROL2');
    const get = run(p);
    const out = get('top.analogSwitch', 'OUT').samples, src = get(M, '2kHz_SINE').samples, ctl = get(M, '8kHz_DIGITAL').samples;
    for (let i = 0; i < out.length; i += 97) expect(out[i]).toBeCloseTo(ctl[i] > 2.5 ? src[i] : 0, 9);
  });
  it('sample-and-hold freezes the input at each CONTROL 1 rising edge', () => {
    const p = createProject();
    wire(p, M, '2kHz_SINE', 'top.analogSwitch', 'S&H_IN');
    wire(p, M, '8kHz_DIGITAL', 'top.analogSwitch', 'CONTROL1');
    const get = run(p);
    const out = get('top.analogSwitch', 'S&H_OUT').samples, src = get(M, '2kHz_SINE').samples, ctl = get(M, '8kHz_DIGITAL').samples;
    let held = src[0];
    for (let i = 1; i < out.length; i += 1) { if (ctl[i] > 2.5 && ctl[i - 1] <= 2.5) held = src[i]; expect(out[i]).toBeCloseTo(held, 9); }
  });
});

describe('Experiments 12–13: PCM', () => {
  const encoderProject = (volts: number) => {
    const p = createProject();
    set(p, 'bottom.variableDcv', 'voltage', volts);
    wire(p, 'bottom.variableDcv', 'VDC', 'bottom.pcmEncoder', 'INPUT1');
    wire(p, M, '100kHz_DIGITAL', 'bottom.pcmEncoder', 'CLK');
    return p;
  };
  it('holds every bit for a full clock period, MSB first, with FS high during bit-0', () => {
    const get = run(encoderProject(1.0));
    const data = get('bottom.pcmEncoder', 'PCM_DATA').samples, fs = get('bottom.pcmEncoder', 'FS').samples;
    const code = Math.round((1 + 2) / 4 * 255);               // 191 = 10111111
    const bitAt = (k: number) => data[k * 80 + 40] > 2.5 ? 1 : 0;   // 100 kHz clock = 80 samples per bit
    let word = 0; for (let k = 0; k < 8; k += 1) word = (word << 1) | bitAt(k);
    expect(word).toBe(code);
    for (let k = 0; k < 8; k += 1) { expect(data[k * 80 + 1]).toBe(data[k * 80 + 79]); expect(fs[k * 80 + 40] > 2.5).toBe(k === 7); }
  });
  it('0 V encodes mid-scale, ±2 V the end codes, and the decoder returns the voltage within one LSB', () => {
    for (const volts of [-2, -1, 0, 0.7, 2]) {
      const p = encoderProject(volts);
      wire(p, 'bottom.pcmEncoder', 'FS', 'bottom.pcmDecoder', 'FS');
      wire(p, 'bottom.pcmEncoder', 'PCM_DATA', 'bottom.pcmDecoder', 'PCM_DATA');
      wire(p, M, '100kHz_DIGITAL', 'bottom.pcmDecoder', 'CLK');
      const out = run(p)('bottom.pcmDecoder', 'OUTPUT').samples;
      expect(mean(out, 8000)).toBeCloseTo(volts === 2 ? 2 : volts, 1);
      expect(Math.abs(mean(out, 8000) - volts)).toBeLessThan(4 / 255 + 1e-9);
    }
  });
});

describe('Experiments 9–10: FM and the zero-crossing detector', () => {
  const fmProject = (volts: number) => {
    const p = createProject();
    set(p, 'bottom.vco', 'range', 'low'); set(p, 'bottom.vco', 'gain', 2); set(p, 'bottom.vco', 'frequencyControl', 9 / 16);
    set(p, 'bottom.variableDcv', 'voltage', volts);
    wire(p, 'bottom.variableDcv', 'VDC', 'bottom.vco', 'VCO_INPUT');
    wire(p, 'bottom.vco', 'SINE', 'top.comparator', 'IN');            // REF left at 0 V (tied to GND on the real trainer)
    wire(p, 'top.comparator', 'OUT', 'top.twinPulse', 'CLK');
    set(p, 'top.twinPulse', 'widthUs', 12);
    wire(p, 'top.twinPulse', 'Q1', 'top.channel.baseband', 'IN');     // digital output into an analog input
    return p;
  };
  it('VCO: 10 kHz rest, +2 V → 15 kHz and −2 V → 5 kHz at full GAIN, fixed 4 Vp-p', () => {
    for (const [v, f] of [[0, 10_000], [2, 15_000], [-2, 5_000]] as const) {
      const sine = run(fmProject(v))('bottom.vco', 'SINE');
      expect(measureSignal(sine).frequency!).toBeCloseTo(f, -2);
      expect(measureSignal(sine).peakToPeak).toBeCloseTo(4, 1);
    }
  });
  it('ZCD + Baseband LPF output rises with frequency (duty cycle ∝ f)', () => {
    const hi = mean(run(fmProject(2))('top.channel.baseband', 'OUT').samples, 6000);
    const lo = mean(run(fmProject(-2))('top.channel.baseband', 'OUT').samples, 6000);
    expect(hi).toBeGreaterThan(lo * 2.2);
  });
});

describe('Experiment 18: serial-to-parallel bit splitter', () => {
  it('X1 carries the even bits and X2 the odd bits from the ÷2 clock', () => {
    const p = createProject();
    wire(p, M, '8kHz_DIGITAL', 'bottom.sequence', 'CLK');
    wire(p, M, '8kHz_DIGITAL', 'bottom.divider', 'IN');
    set(p, 'bottom.divider', 'ratio', '2');
    wire(p, 'bottom.sequence', 'X', 'bottom.serialToParallel', 'SERIAL');
    wire(p, 'bottom.divider', 'OUT', 'bottom.serialToParallel', 'CLK');
    const get = run(p);
    const x = get('bottom.sequence', 'X').samples, x1 = get('bottom.serialToParallel', 'X1').samples, x2 = get('bottom.serialToParallel', 'X2').samples;
    const bit = 960;
    for (let k = 0; k < 14; k += 2) {
      expect(x1[k * bit + bit / 2]).toBe(x[k * bit + bit / 2] > 2.5 ? 1 : -1);
      expect(x2[(k + 1) * bit + bit / 2]).toBe(x[(k + 1) * bit + bit / 2] > 2.5 ? 1 : -1);
    }
  });
});

describe('Sequence generator and noise', () => {
  it('X repeats every 31 bits (16 ones) and SYNC lasts one bit', () => {
    const p = createProject();
    wire(p, M, '100kHz_DIGITAL', 'bottom.sequence', 'CLK');
    const get = run(p);
    const x = get('bottom.sequence', 'X').samples, sync = get('bottom.sequence', 'SYNC').samples;
    const bits: number[] = Array.from({ length: 62 }, (_, k) => x[k * 80 + 40] > 2.5 ? 1 : 0);
    expect(bits.slice(0, 31)).toEqual(bits.slice(31, 62));
    expect(bits.slice(0, 31).reduce((a, b) => a + b, 0)).toBe(16);
    const syncSamples = sync.filter((v) => v > 2.5).length; // one 80-sample bit per 31-bit sequence start (7 starts in the window)
    expect(syncSamples).toBeGreaterThan(80 * 6); expect(syncSamples).toBeLessThanOrEqual(80 * 7 + 2);
  });
  it('noise is band-limited below ≈240 kHz with ≈1 V rms at the 0 dB tap', () => {
    const p = createProject();
    const n = run(p)('top.noise', '0dB');
    expect(rms(n.samples)).toBeCloseTo(1, 1);
    const bins = calculateSpectrum(n, 'hann');
    let low = 0, total = 0;
    for (const b of bins) { total += b.magnitude ** 2; if (Math.abs(b.frequency) < 300_000) low += b.magnitude ** 2; }
    expect(low / total).toBeGreaterThan(0.95);
  });
});

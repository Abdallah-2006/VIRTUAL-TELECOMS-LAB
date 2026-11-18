import { describe, expect, it } from 'vitest';
import { processorRegistry } from '../src/engine/processors';
import type { SignalBuffer, SimulationContext } from '../src/types';

const makeContext = (sampleRate = 500_000, sampleCount = 1024, moduleId = 'test.module', moduleType = 'utility.buffer'): SimulationContext => ({ sampleRate, sampleCount, startTime: 0, moduleId, moduleType });
const signal = (values: number[], sampleRate = 500_000, signalType: 'analog' | 'digital' = 'analog', frequency?: number): SignalBuffer => ({
  samples: Float64Array.from(values), sampleRate, startTime: 0, signalType,
  metadata: { name: 'test', unit: signalType === 'digital' ? 'logic V' : 'V', sourceModuleId: 'test-source', frequency },
});

function tone(rate: number, count: number, frequency: number, amplitude = 1): Float64Array {
  return Float64Array.from({ length: count }, (_, index) => amplitude * Math.sin(2 * Math.PI * frequency * index / rate));
}

describe('source-documented and labeled ETT-101 DSP', () => {
  it('applies independent inverting Adder gains numerically', () => {
    const result = processorRegistry.adderVariable(
      { A: signal([1, -2]), B: signal([2, 3]) },
      { gainA: 0.5, gainB: 0.25 },
      makeContext(500_000, 2, 'top.adder', 'adder.variable'),
    );
    expect(Array.from(result['GA+gB'].samples)).toEqual([-1, 0.25]);
  });

  it('multiplies physically connected Multiplier AC inputs and adds unconnected alternatives as zero', () => {
    const result = processorRegistry.multiplier(
      { X_AC: signal([2, -2]), Y_AC: signal([3, 4]) },
      {}, makeContext(500_000, 2, 'top.multiplier.upper', 'multiplier.four'),
    );
    expect(Array.from(result.kXY.samples)).toEqual([6, -8]);
    expect(() => processorRegistry.multiplier({}, {}, makeContext(500_000, 2, 'm', 'multiplier.four'))).toThrow(/X axis/);
  });

  it('applies Buffer gain and actual selected module control values', () => {
    const result = processorRegistry.buffer({ IN: signal([2, -4, 0.5]) }, { gain: 0.25 }, makeContext(500_000, 3));
    expect(Array.from(result.OUT.samples)).toEqual([0.5, -1, 0.125]);
  });

  it('uses a quadrature signal for a real 90-degree Hilbert phase approximation', () => {
    const rate = 48_000, count = 4096, input = signal(Array.from(tone(rate, count, 1200)), rate);
    const result = processorRegistry.phaseShifter({ IN: input }, { phaseDegrees: 90, invert: 'normal' }, makeContext(rate, count, 'phase', 'phase.shifter')).OUT.samples;
    let correlation = 0, sourceEnergy = 0, resultEnergy = 0;
    for (let index = 128; index < count; index += 1) {
      correlation += input.samples[index] * result[index];
      sourceEnergy += input.samples[index] ** 2;
      resultEnergy += result[index] ** 2;
    }
    expect(Math.abs(correlation / Math.sqrt(sourceEnergy * resultEnergy))).toBeLessThan(0.06);
    expect(Math.sqrt(resultEnergy / sourceEnergy)).toBeGreaterThan(0.85);
    expect(Math.sqrt(resultEnergy / sourceEnergy)).toBeLessThan(1.15);
  });

  it('attenuates a 10 kHz tone through the fixed baseband low-pass', () => {
    const rate = 96_000, count = 8192, input = signal(Array.from(tone(rate, count, 10_000)), rate);
    const result = processorRegistry.lowpass({ IN: input }, {}, makeContext(rate, count, 'baseband', 'filter.baseband')).OUT.samples;
    const rms = (values: Float64Array) => Math.sqrt(Array.from(values).reduce((sum, value) => sum + value * value, 0) / values.length);
    expect(rms(result)).toBeLessThan(rms(input.samples) * 0.08);
  });

  it('produces a controlled oscillator output at the selected physical frequency range', () => {
    const result = processorRegistry.vco({}, { range: 'low', frequencyControl: 0.25, gain: 0.6 }, makeContext(96_000, 8192, 'bottom.vco', 'vco'));
    expect(result.SINE.metadata.frequency).toBe(5000);
    expect(result.SINE.signalType).toBe('analog');
    expect(result.DIGITAL.signalType).toBe('digital');
    expect(Math.max(...result.SINE.samples)).toBeCloseTo(0.6, 1);
  });

  it('generates repeatable broadband Gaussian noise and preserves physical dB tap ratios', () => {
    const context = makeContext(500_000, 4096, 'top.noise', 'source.noise');
    const first = processorRegistry.noise({}, {}, context);
    const second = processorRegistry.noise({}, {}, context);
    expect(first['0dB'].samples).toEqual(second['0dB'].samples);
    const rms = (values: Float64Array) => Math.sqrt(Array.from(values).reduce((sum, value) => sum + value * value, 0) / values.length);
    expect(rms(first['-6dB'].samples) / rms(first['0dB'].samples)).toBeCloseTo(10 ** (-6 / 20), 1);
    expect(rms(first['-20dB'].samples) / rms(first['0dB'].samples)).toBeCloseTo(0.1, 1);
  });

  it('encodes a constant analog sample into real clocked PCM and decodes an 8-bit reconstruction', () => {
    const rate = 8000, count = 8192, f = 1000;
    const clock = signal(Array.from({ length: count }, (_, index) => Math.sin(2 * Math.PI * f * index / rate) >= 0 ? 5 : 0), rate, 'digital', f);
    const analogIn = signal(new Array(count).fill(1), rate);
    const context = makeContext(rate, count, 'pcm-encoder', 'pcm.encoder');
    const encoded = processorRegistry.pcmEncoder({ INPUT1: analogIn, CLK: clock }, { mode: 'pcm' }, context);
    expect(encoded.PCM_DATA.signalType).toBe('digital');
    expect(encoded.FS.samples.filter((value) => value > 2.5).length).toBeGreaterThan(5);
    expect(encoded.PCM_DATA.samples.some((value) => value === 0)).toBe(true);
    expect(encoded.PCM_DATA.samples.some((value) => value === 5)).toBe(true);

    const decoded = processorRegistry.pcmDecoder({ FS: encoded.FS, PCM_DATA: encoded.PCM_DATA, CLK: clock }, {}, { ...context, moduleId: 'pcm-decoder', moduleType: 'pcm.decoder' });
    const settled = Array.from(decoded.OUTPUT.samples).slice(80);
    const mean = settled.reduce((sum, value) => sum + value, 0) / settled.length;
    expect(mean).toBeCloseTo(1, 1);
    expect(decoded.OUTPUT2.signalType).toBe('analog');
  });
});

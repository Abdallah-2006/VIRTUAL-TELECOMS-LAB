import type { SignalBuffer } from '../types';

export interface SignalMeasurements { mean: number; rms: number; peak: number; peakToPeak: number; frequency: number | null; period: number | null }

export function measureSignal(signal: SignalBuffer): SignalMeasurements {
  const samples = signal.samples;
  if (!samples.length) return { mean: 0, rms: 0, peak: 0, peakToPeak: 0, frequency: null, period: null };
  let sum = 0;
  let squareSum = 0;
  let peak = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of samples) {
    sum += value;
    squareSum += value * value;
    peak = Math.max(peak, Math.abs(value));
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const mean = sum / samples.length;
  const crossings: number[] = [];
  for (let n = 1; n < samples.length; n += 1) {
    const before = samples[n - 1] - mean;
    const after = samples[n] - mean;
    if (before <= 0 && after > 0) {
      const fraction = before === after ? 0 : -before / (after - before);
      crossings.push(n - 1 + fraction);
    }
  }
  let frequency: number | null = null;
  if (crossings.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < crossings.length; i += 1) intervals.push((crossings[i] - crossings[i - 1]) / signal.sampleRate);
    const average = intervals.reduce((total, item) => total + item, 0) / intervals.length;
    if (average > 0) frequency = 1 / average;
  }
  return { mean, rms: Math.sqrt(squareSum / samples.length), peak, peakToPeak: maximum - minimum, frequency, period: frequency ? 1 / frequency : null };
}

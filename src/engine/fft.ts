import type { SignalBuffer, SpectrumWindow } from '../types';

export interface SpectrumBin { frequency: number; magnitude: number }

function isPowerOfTwo(value: number): boolean { return value > 0 && (value & (value - 1)) === 0; }

export function calculateSpectrum(signal: SignalBuffer, window: SpectrumWindow = 'hann'): SpectrumBin[] {
  const length = signal.samples.length;
  if (!isPowerOfTwo(length)) throw new Error('FFT input length must be a power of two.');
  const real = new Float64Array(length);
  const imag = new Float64Array(length);
  let windowSum = 0;
  for (let n = 0; n < length; n += 1) {
    const weight = window === 'hann' ? 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (length - 1)) : 1;
    real[n] = signal.samples[n] * weight;
    windowSum += weight;
  }
  for (let i = 1, j = 0; i < length; i += 1) {
    let bit = length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let size = 2; size <= length; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    for (let start = 0; start < length; start += size) {
      let twiddleReal = 1;
      let twiddleImag = 0;
      for (let offset = 0; offset < size / 2; offset += 1) {
        const even = start + offset;
        const odd = even + size / 2;
        const oddReal = real[odd] * twiddleReal - imag[odd] * twiddleImag;
        const oddImag = real[odd] * twiddleImag + imag[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
        const nextReal = twiddleReal * stepReal - twiddleImag * stepImag;
        twiddleImag = twiddleReal * stepImag + twiddleImag * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
  const bins: SpectrumBin[] = [];
  // FFT-shift the full transform so the DC component is centered and the
  // negative-frequency half is shown to its left. Two-sided magnitudes retain
  // the Fourier coefficient scale (unlike the doubled one-sided display).
  for (let index = 0; index < length; index += 1) {
    const frequencyBin = index - length / 2;
    const fftBin = (frequencyBin + length) % length;
    bins.push({ frequency: (frequencyBin * signal.sampleRate) / length, magnitude: Math.hypot(real[fftBin], imag[fftBin]) / windowSum });
  }
  return bins;
}

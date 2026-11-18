import { calculateSpectrum } from '../fft';
import type { SignalBuffer, SpectrumWindow } from '../../types';

interface WorkerScope {
  onmessage: ((event: MessageEvent<{ signal: SignalBuffer; windowType: SpectrumWindow }>) => void) | null;
  postMessage(message: unknown): void;
}
const workerScope = self as unknown as WorkerScope;
workerScope.onmessage = (event) => {
  try {
    const bins = calculateSpectrum(event.data.signal, event.data.windowType);
    workerScope.postMessage({ ok: true, bins });
  } catch (error) {
    workerScope.postMessage({ ok: false, error: error instanceof Error ? error.message : 'FFT worker failed.' });
  }
};

import { simulateProject } from '../simulation';
import type { Project } from '../../types';

type WorkerRequest = {
  requestId: number;
  project: Project;
  externalInputs?: Record<string, { samples: Float64Array; sampleRate: number }>;
  startTime?: number;
};
interface WorkerScope { onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null; postMessage(message: unknown): void }
const workerScope = self as unknown as WorkerScope;
workerScope.onmessage = (event) => {
  const { requestId, project, externalInputs, startTime = 0 } = event.data;
  try {
    const result = simulateProject(project, externalInputs, startTime);
    workerScope.postMessage({ requestId, ok: true, result });
  } catch (error) {
    workerScope.postMessage({ requestId, ok: false, error: error instanceof Error ? error.message : 'Simulation worker failed.' });
  }
};

import type { Project } from '../types';

/**
 * The solver signature deliberately ignores purely visual lead state (colour and routing).
 * Recolouring or reshaping a patch lead therefore never marks the circuit stale or causes the
 * DSP graph to be recalculated; only electrical endpoints, parameters and probes do.
 */
export function makeSignature(project: Project): string {
  return JSON.stringify({
    settings: project.settings,
    modules: project.modules.map(({ id, type, parameters }) => ({ id, type, parameters })),
    connections: project.connections
      .map(({ id, sourceSocketId, targetSocketId }) => ({ id, sourceSocketId, targetSocketId }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    observedChannels: project.instruments.scopeChannels.map(({ id, enabled, sourceKey }) => ({ id, enabled, sourceKey })),
    spectrumSource: project.instruments.spectrumSource,
  });
}

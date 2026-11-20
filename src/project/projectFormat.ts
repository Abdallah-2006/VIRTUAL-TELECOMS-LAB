import type { Connection, ModuleInstance, Project, ScopeChannel } from '../types';
import { moduleByType } from '../modules/registry';
import { validateConnection } from '../engine/graph';
import { outputKey, socketId } from '../types';
import { HARDWARE_MODULES } from '../hardware/layout';
import { normalizeRouting } from '../hardware/cableGeometry';

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const cableColors = new Set(['red', 'black', 'yellow', 'green', 'blue', 'white']);
const scopeIds: ScopeChannel['id'][] = ['CH1', 'CH2', 'CH3', 'CH4'];

export function createHardwareModules(): ModuleInstance[] {
  return HARDWARE_MODULES.map((layout) => {
    const definition = moduleByType.get(layout.type);
    if (!definition) throw new Error(`Physical module ${layout.id} references unknown type ${layout.type}.`);
    return { id: layout.id, type: layout.type, x: layout.x, y: layout.y, parameters: { ...definition.defaults } };
  });
}

export function createProject(name = 'ETT-101 · Untitled Experiment'): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2, id: makeId(), name, createdAt: now, updatedAt: now,
    settings: { sampleRate: 8_000_000, sampleCount: 131_072, simulationSpeed: 1 },
    modules: createHardwareModules(), connections: [],
    instruments: {
      scopeChannels: scopeIds.map((id) => ({
        id, enabled: true,
        sourceKey: '',
        voltsPerDiv: 1, verticalPosition: 0,
      })),
      spectrumSource: outputKey('bottom.masterSignals', '100kHz_SINE'), spectrumWindow: 'hann', timePerDiv: 0.0002,
      triggerSource: 'CH1', triggerLevel: 0, triggerMode: 'auto', running: true,
    },
    experiment: { id: null, mode: 'free', step: 0 },
    view: { zoom: 1, panX: 0, panY: 0 },
  };
}

function assertParameterValue(type: string, parameters: Record<string, number | string>): void {
  const definition = moduleByType.get(type);
  if (!definition) throw new Error(`Unknown physical module type “${type}”.`);
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error(`${definition.name} parameters must be an object.`);
  const knownKeys = new Set(definition.parameters.map((parameter) => parameter.key));
  for (const key of Object.keys(parameters)) if (!knownKeys.has(key)) throw new Error(`${definition.name} has an unsupported parameter “${key}”.`);
  for (const parameter of definition.parameters) {
    const current = parameters[parameter.key];
    if (parameter.kind === 'select') {
      if (typeof current !== 'string' || !parameter.options.some((option) => option.value === current)) throw new Error(`${definition.name}: invalid value for ${parameter.label}.`);
    } else if (typeof current !== 'number' || !Number.isFinite(current) || current < parameter.min || current > parameter.max) {
      throw new Error(`${definition.name}: ${parameter.label} must be between ${parameter.min} and ${parameter.max}.`);
    }
  }
}

function assertOutputKey(value: string, label: string, modules: ModuleInstance[]): void {
  if (!value) return;
  const [moduleId, portName, extra] = value.split(':');
  if (!moduleId || !portName || extra !== undefined) throw new Error(`${label} must identify a module output.`);
  const module = modules.find((item) => item.id === moduleId);
  const definition = module ? moduleByType.get(module.type) : undefined;
  if (!definition?.outputs.some((port) => port.name === portName)) throw new Error(`${label} references an unknown physical output.`);
}

export function validateImportedProject(value: unknown): Project {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Project file must contain a JSON object.');
  const candidate = value as Partial<Project>;
  if (candidate.schemaVersion !== 2) throw new Error('Unsupported project schema version. Export a schemaVersion 2 physical trainer project.');
  if (typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 120) throw new Error('Project name must contain 1–120 characters.');
  if (typeof candidate.id !== 'string' || !candidate.id) throw new Error('Project ID is missing.');
  const settings = candidate.settings;
  if (!settings || !Number.isFinite(settings.sampleRate) || settings.sampleRate < 100_000 || settings.sampleRate > 100_000_000) throw new Error('Sample rate must be between 100 kSa/s and 100 MSa/s.');
  if (!Number.isInteger(settings.sampleCount) || settings.sampleCount < 16 || settings.sampleCount > 262_144 || (settings.sampleCount & (settings.sampleCount - 1)) !== 0) throw new Error('Sample count must be a power of two from 16 through 262,144.');
  if (!Number.isFinite(settings.simulationSpeed) || settings.simulationSpeed < 0.25 || settings.simulationSpeed > 4) throw new Error('Simulation speed must be between 0.25× and 4×.');
  if (!Array.isArray(candidate.modules) || !Array.isArray(candidate.connections)) throw new Error('Project modules and connections must be arrays.');

  const expected = HARDWARE_MODULES;
  if (candidate.modules.length !== expected.length) throw new Error(`A physical ETT-101 project must preserve all ${expected.length} fixed hardware functions.`);
  const modulesById = new Map<string, ModuleInstance>();
  for (const raw of candidate.modules) {
    if (!raw || typeof raw.id !== 'string' || !raw.id || modulesById.has(raw.id)) throw new Error('Every physical function must have a unique module ID.');
    modulesById.set(raw.id, raw);
  }
  for (const layout of expected) {
    const module = modulesById.get(layout.id);
    if (!module || module.type !== layout.type) throw new Error(`The fixed hardware panel is missing or has altered module ${layout.id}.`);
    if (module.x !== layout.x || module.y !== layout.y) throw new Error(`Physical module ${layout.id} cannot be moved from its measured panel position.`);
    assertParameterValue(module.type, module.parameters);
  }
  if (candidate.connections.length > 300) throw new Error('Project exceeds the supported number of patch leads.');

  const safeProject = createProject(candidate.name.trim());
  safeProject.id = candidate.id;
  safeProject.createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString();
  safeProject.updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString();
  safeProject.settings = { sampleRate: settings.sampleRate, sampleCount: settings.sampleCount, simulationSpeed: settings.simulationSpeed };
  safeProject.modules = expected.map((layout) => {
    const imported = modulesById.get(layout.id)!;
    return { id: layout.id, type: layout.type, x: layout.x, y: layout.y, parameters: { ...imported.parameters } };
  });

  const connectionIds = new Set<string>();
  for (const connection of candidate.connections as Connection[]) {
    if (!connection || typeof connection.id !== 'string' || !connection.id || connectionIds.has(connection.id)) throw new Error('Patch lead IDs must be present and unique.');
    connectionIds.add(connection.id);
    if (connection.state !== 'active' || !cableColors.has(connection.color)) throw new Error(`Patch lead ${connection.id} has an invalid state or cable color.`);
    if (connection.sourceSocketId !== socketId(connection.sourceModuleId, connection.sourcePort) || connection.targetSocketId !== socketId(connection.targetModuleId, connection.targetPort)) throw new Error(`Patch lead ${connection.id} has inconsistent socket IDs.`);
    const routing = normalizeRouting(connection.routing, `Patch lead ${connection.id} routing`);
    const validation = validateConnection(safeProject, connection.sourceModuleId, connection.sourcePort, connection.targetModuleId, connection.targetPort);
    if (!validation.ok) throw new Error(`Invalid patch lead: ${validation.reason}`);
    safeProject.connections.push({ ...connection, routing });
  }

  const instruments = candidate.instruments;
  if (!instruments || !Array.isArray(instruments.scopeChannels) || instruments.scopeChannels.length !== 4) throw new Error('The project must contain four independent scope channels.');
  safeProject.instruments.scopeChannels = scopeIds.map((id, index) => {
    const channel = instruments.scopeChannels![index];
    if (!channel || channel.id !== id || typeof channel.enabled !== 'boolean' || typeof channel.sourceKey !== 'string' || !Number.isFinite(channel.voltsPerDiv) || channel.voltsPerDiv <= 0 || !Number.isFinite(channel.verticalPosition)) throw new Error(`Scope channel ${id} settings are invalid.`);
    assertOutputKey(channel.sourceKey, `${id} probe`, safeProject.modules);
    const scopeConnection = safeProject.connections.find((edge) => edge.targetModuleId === `scope.${id}` && edge.targetPort === 'IN');
    return { ...channel, sourceKey: scopeConnection ? outputKey(scopeConnection.sourceModuleId, scopeConnection.sourcePort) : '' };
  });
  const spectrumWindow = instruments.spectrumWindow === 'rectangular' ? 'rectangular' : instruments.spectrumWindow === 'hann' ? 'hann' : null;
  if (!spectrumWindow) throw new Error('FFT window must be Hann or Rectangular.');
  if (typeof instruments.spectrumSource !== 'string') throw new Error('Spectrum source must be an output key.');
  assertOutputKey(instruments.spectrumSource, 'Spectrum source', safeProject.modules);
  if (!Number.isFinite(instruments.timePerDiv) || instruments.timePerDiv <= 0 || !['CH1', 'CH2', 'CH3', 'CH4'].includes(instruments.triggerSource) || !Number.isFinite(instruments.triggerLevel) || !['auto', 'normal', 'single'].includes(instruments.triggerMode) || typeof instruments.running !== 'boolean') throw new Error('Oscilloscope settings are invalid.');
  safeProject.instruments = {
    ...safeProject.instruments,
    scopeChannels: safeProject.instruments.scopeChannels,
    spectrumSource: instruments.spectrumSource,
    spectrumWindow,
    timePerDiv: instruments.timePerDiv,
    triggerSource: instruments.triggerSource,
    triggerLevel: instruments.triggerLevel,
    triggerMode: instruments.triggerMode,
    running: instruments.running,
    timeOffset: Number.isFinite(instruments.timeOffset) && (instruments.timeOffset as number) >= 0 ? (instruments.timeOffset as number) : 0,
  };
  if (!candidate.experiment || (candidate.experiment.mode !== 'free' && candidate.experiment.mode !== 'guided') || !Number.isInteger(candidate.experiment.step) || candidate.experiment.step < 0 || !(candidate.experiment.id === null || typeof candidate.experiment.id === 'string')) throw new Error('Experiment state is invalid.');
  safeProject.experiment = { ...candidate.experiment };
  safeProject.view = { zoom: 1, panX: 0, panY: 0 };
  return safeProject;
}

import type { Project, SimulationResult, ModuleInputs, SignalBuffer } from '../types';
import { moduleByType } from '../modules/registry';
import { outputKey, socketId } from '../types';
import { topologicalOrder } from './graph';
import { processorRegistry } from './processors';

export function simulateProject(
  project: Project,
  externalInputs?: Record<string, { samples: Float64Array; sampleRate: number }>,
  startTime = 0,
): SimulationResult {
  const outputs: Record<string, SignalBuffer> = {};
  const errors: Record<string, string> = {};
  let order: string[] = [];
  const { sampleRate, sampleCount } = project.settings;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > 100_000_000) return { outputs, errors: { _project: 'Sample rate must be finite and between 0 and 100 MHz.' }, order };
  if (!Number.isInteger(sampleCount) || sampleCount < 16 || sampleCount > 262_144) return { outputs, errors: { _project: 'Sample count must be an integer between 16 and 262,144.' }, order };
  try {
    order = topologicalOrder(project);
  } catch (error) {
    return { outputs, errors: { _project: error instanceof Error ? error.message : 'Invalid patch graph.' }, order };
  }
  const moduleById = new Map(project.modules.map((module) => [module.id, module]));
  const activeModules = new Set<string>();
  for (const connection of project.connections) { activeModules.add(connection.sourceModuleId); activeModules.add(connection.targetModuleId); }
  for (const channel of project.instruments.scopeChannels) if (channel.sourceKey) activeModules.add(channel.sourceKey.split(':')[0]);
  if (project.instruments.spectrumSource) activeModules.add(project.instruments.spectrumSource.split(':')[0]);
  for (const moduleId of order) {
    const instance = moduleById.get(moduleId)!;
    const definition = moduleByType.get(instance.type);
    if (!definition) { errors[moduleId] = `Unknown physical module type “${instance.type}”.`; continue; }
    if (!definition.implemented) { errors[moduleId] = 'This hardware processor is not implemented.'; continue; }
    const sourceProcessor = definition.inputs.length === 0 && definition.processor !== 'speech';
    if (!sourceProcessor && !activeModules.has(moduleId)) continue;
    const inputs: ModuleInputs = {};
    let missing: string | undefined;
    for (const port of definition.inputs) {
      const edge = project.connections.find((item) => item.targetSocketId === socketId(moduleId, port.name));
      if (!edge) {
        if (port.optional) continue;
        missing = `Input ${port.name} has no patch lead.`;
        break;
      }
      const signal = outputs[outputKey(edge.sourceModuleId, edge.sourcePort)];
      if (!signal) { missing = `Input ${port.name} has no valid upstream signal.`; break; }
      if (signal.signalType !== port.signalType) { missing = `Input ${port.name} expects ${port.signalType}, received ${signal.signalType}.`; break; }
      inputs[port.name] = signal;
    }
    if (missing) { errors[moduleId] = missing; continue; }
    const processor = processorRegistry[definition.processor];
    if (!processor) { errors[moduleId] = `Processor “${definition.processor}” is not registered.`; continue; }
    try {
      const moduleOutputs = processor(inputs, instance.parameters, {
        sampleRate, sampleCount, startTime, moduleId, moduleType: instance.type, externalInputs,
      });
      for (const [port, signal] of Object.entries(moduleOutputs)) {
        const expected = definition.outputs.find((candidate) => candidate.name === port);
        if (!expected) throw new Error(`Processor returned undeclared output ${port}.`);
        if (signal.samples.length !== sampleCount || signal.sampleRate !== sampleRate || signal.signalType !== expected.signalType) {
          throw new Error(`Output ${port} returned an invalid buffer or signal type.`);
        }
        for (let i = 0; i < signal.samples.length; i += 1) {
          if (!Number.isFinite(signal.samples[i])) throw new Error(`Output ${port} contains a non-finite sample at index ${i}.`);
        }
        outputs[outputKey(moduleId, port)] = signal;
      }
    } catch (error) {
      errors[moduleId] = error instanceof Error ? error.message : 'Module processing failed.';
    }
  }
  return { outputs, errors, order };
}

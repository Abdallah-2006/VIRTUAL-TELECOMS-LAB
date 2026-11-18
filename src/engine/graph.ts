import type { Connection, Project } from '../types';
import { moduleByType } from '../modules/registry';
import { socketId } from '../types';

export type ConnectionValidation = { ok: true } | { ok: false; reason: string };

const scopeInputIds = new Set(['scope.CH1', 'scope.CH2', 'scope.CH3', 'scope.CH4']);

export function validateConnection(
  project: Pick<Project, 'modules' | 'connections'>,
  sourceModuleId: string,
  sourcePort: string,
  targetModuleId: string,
  targetPort: string,
): ConnectionValidation {
  if (scopeInputIds.has(targetModuleId)) {
    if (targetPort !== 'IN') return { ok: false, reason: 'Oscilloscope inputs only expose an IN terminal.' };
    const source = project.modules.find((item) => item.id === sourceModuleId);
    const sourceDef = source ? moduleByType.get(source.type) : undefined;
    if (!source || !sourceDef?.outputs.some((port) => port.name === sourcePort)) return { ok: false, reason: 'The oscilloscope lead must start at an EMONA output socket.' };
    const targetSocketId = socketId(targetModuleId, targetPort);
    if (project.connections.some((edge) => edge.targetSocketId === targetSocketId)) return { ok: false, reason: `${targetModuleId.replace('scope.', '')} already has a patch lead.` };
    return { ok: true };
  }
  const source = project.modules.find((item) => item.id === sourceModuleId);
  const target = project.modules.find((item) => item.id === targetModuleId);
  if (!source || !target) return { ok: false, reason: 'Both physical modules must exist on the trainer.' };
  if (sourceModuleId === targetModuleId) return { ok: false, reason: 'A physical module cannot connect directly to itself.' };
  const sourceDef = moduleByType.get(source.type);
  const targetDef = moduleByType.get(target.type);
  const output = sourceDef?.outputs.find((port) => port.name === sourcePort);
  const input = targetDef?.inputs.find((port) => port.name === targetPort);
  if (!output) return { ok: false, reason: `${sourceDef?.name ?? 'Source'} has no output socket “${sourcePort}”.` };
  if (!input) return { ok: false, reason: `${targetDef?.name ?? 'Destination'} has no input socket “${targetPort}”.` };
  if (output.signalType !== input.signalType) return { ok: false, reason: `Cannot connect ${output.signalType} output to ${input.signalType} input.` };
  const sourceSocketId = socketId(sourceModuleId, sourcePort);
  const targetSocketId = socketId(targetModuleId, targetPort);
  if (project.connections.some((edge) => edge.sourceSocketId === sourceSocketId && edge.targetSocketId === targetSocketId)) {
    return { ok: false, reason: 'That patch lead already exists.' };
  }
  if (project.connections.some((edge) => edge.targetSocketId === targetSocketId)) {
    return { ok: false, reason: `Input ${targetPort} is a single-driver socket. Remove its existing lead before repatching.` };
  }
  if (wouldCreateCycle(project.connections, sourceModuleId, targetModuleId)) {
    return { ok: false, reason: 'That lead would create a feedback cycle. Add a documented delay stage before making a feedback loop.' };
  }
  // There is intentionally no source-output uniqueness check: every output may fan out.
  return { ok: true };
}

function wouldCreateCycle(connections: Connection[], sourceId: string, targetId: string): boolean {
  const pending = [targetId];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of connections) if (edge.sourceModuleId === current) pending.push(edge.targetModuleId);
  }
  return false;
}

export function topologicalOrder(project: Pick<Project, 'modules' | 'connections'>): string[] {
  const indegree = new Map(project.modules.map((module) => [module.id, 0]));
  const outgoing = new Map(project.modules.map((module) => [module.id, [] as string[]]));
  for (const edge of project.connections) {
    if (scopeInputIds.has(edge.targetModuleId)) continue;
    if (!indegree.has(edge.sourceModuleId) || !indegree.has(edge.targetModuleId)) throw new Error('A cable refers to a missing physical module.');
    indegree.set(edge.targetModuleId, (indegree.get(edge.targetModuleId) ?? 0) + 1);
    outgoing.get(edge.sourceModuleId)!.push(edge.targetModuleId);
  }
  const queue = project.modules.filter((module) => indegree.get(module.id) === 0).map((module) => module.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const targetId of outgoing.get(id) ?? []) {
      const next = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, next);
      if (next === 0) queue.push(targetId);
    }
  }
  if (order.length !== project.modules.length) throw new Error('The patch graph contains a directed cycle.');
  return order;
}

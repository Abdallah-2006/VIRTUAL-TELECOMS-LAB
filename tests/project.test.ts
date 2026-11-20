import { describe, expect, it } from 'vitest';
import { createProject, validateImportedProject } from '../src/project/projectFormat';
import { simulateProject } from '../src/engine/simulation';
import { outputKey, socketId } from '../src/types';
import { HARDWARE_MODULES } from '../src/hardware/layout';
import { validateConnection } from '../src/engine/graph';

describe('fixed ETT-101 project format', () => {
  it('starts with every physical trainer function and no prewired experiment or scope leads', () => {
    const project = createProject('ETT-101 · Free Lab');
    expect(project.schemaVersion).toBe(2);
    expect(project.settings.sampleRate).toBe(8_000_000);
    expect(project.settings.sampleCount).toBe(131_072);
    expect(project.modules).toHaveLength(HARDWARE_MODULES.length);
    expect(project.modules.map((module) => module.id)).toEqual(HARDWARE_MODULES.map((module) => module.id));
    expect(project.connections).toHaveLength(0);
    expect(project.instruments.scopeChannels).toHaveLength(4);
    expect(project.instruments.scopeChannels.every((channel) => channel.sourceKey === '')).toBe(true);
    expect(simulateProject(project).errors).toEqual({});
  });

  it('round-trips editable analog circuits, cable colors and independent scope probes', () => {
    const project = createProject('DSB-SC lab');
    const connect = (sourceModuleId: string, sourcePort: string, targetModuleId: string, targetPort: string, color: 'red' | 'black') => {
      const validation = validateConnection(project, sourceModuleId, sourcePort, targetModuleId, targetPort);
      expect(validation.ok).toBe(true);
      project.connections.push({
        id: `lead-${project.connections.length + 1}`,
        sourceModuleId, sourcePort, targetModuleId, targetPort,
        sourceSocketId: socketId(sourceModuleId, sourcePort), targetSocketId: socketId(targetModuleId, targetPort), color, routing: [], state: 'active',
      });
    };
    connect('bottom.masterSignals', '2kHz_SINE', 'top.multiplier.upper', 'X_AC', 'red');
    connect('bottom.masterSignals', '100kHz_SINE', 'top.multiplier.upper', 'Y_AC', 'black');
    connect('top.multiplier.upper', 'kXY', 'scope.CH1', 'IN', 'red');
    connect('bottom.masterSignals', '100kHz_SINE', 'scope.CH2', 'IN', 'black');
    project.instruments.spectrumSource = outputKey('top.multiplier.upper', 'kXY');

    const restored = validateImportedProject(JSON.parse(JSON.stringify(project)));
    expect(restored.name).toBe('DSB-SC lab');
    expect(restored.connections).toHaveLength(4);
    expect(restored.connections[0].color).toBe('red');
    expect(restored.instruments.scopeChannels.map((channel) => channel.sourceKey).slice(0, 2)).toEqual([outputKey('top.multiplier.upper', 'kXY'), outputKey('bottom.masterSignals', '100kHz_SINE')]);
    expect(restored.modules.find((module) => module.id === 'top.multiplier.upper')?.parameters).toEqual({});
  });

  it('rejects missing hardware functions, moved modules, invalid parameters, unsafe types and inconsistent socket IDs', () => {
    const project = createProject();
    const missing = structuredClone(project);
    missing.modules.pop();
    expect(() => validateImportedProject(missing)).toThrow(/fixed hardware functions/i);

    const moved = structuredClone(project);
    moved.modules.find((module) => module.id === 'bottom.vco')!.x += 10;
    expect(() => validateImportedProject(moved)).toThrow(/cannot be moved/i);

    const invalid = structuredClone(project);
    invalid.modules.find((module) => module.id === 'top.phaseShifter')!.parameters.phaseDegrees = 361;
    expect(() => validateImportedProject(invalid)).toThrow(/PHASE/);

    const unsafe = structuredClone(project);
    unsafe.modules[0].type = 'script.run';
    expect(() => validateImportedProject(unsafe)).toThrow(/missing or has altered/);

    const corruptCable = structuredClone(project);
    corruptCable.connections.push({
      id: 'bad-lead', sourceModuleId: 'bottom.masterSignals', sourcePort: '100kHz_SINE',
      targetModuleId: 'top.buffer', targetPort: 'IN', sourceSocketId: 'wrong-id',
      targetSocketId: socketId('top.buffer', 'IN'), color: 'blue', routing: [], state: 'active',
    });
    expect(() => validateImportedProject(corruptCable)).toThrow(/inconsistent socket IDs/);
  });
});

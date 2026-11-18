import { describe, expect, it } from 'vitest';
import { calculateSpectrum } from '../src/engine/fft';
import { simulateProject } from '../src/engine/simulation';
import { validateConnection, topologicalOrder } from '../src/engine/graph';
import { createProject } from '../src/project/projectFormat';
import { outputKey, socketId } from '../src/types';
import type { Connection, Project, SignalBuffer } from '../src/types';

let leadCounter = 0;
function connect(project: Project, sourceModuleId: string, sourcePort: string, targetModuleId: string, targetPort: string, color: Connection['color'] = 'red') {
  const validation = validateConnection(project, sourceModuleId, sourcePort, targetModuleId, targetPort);
  if (!validation.ok) throw new Error(validation.reason);
  leadCounter += 1;
  project.connections.push({
    id: `test-lead-${leadCounter}`, sourceModuleId, sourcePort, targetModuleId, targetPort,
    sourceSocketId: socketId(sourceModuleId, sourcePort), targetSocketId: socketId(targetModuleId, targetPort), color, routing: [], state: 'active',
  });
}
const sidebandPeak = (signal: SignalBuffer, targetHz: number) => calculateSpectrum(signal, 'hann')
  .filter((bin) => Math.abs(Math.abs(bin.frequency) - targetHz) < 800)
  .reduce((best, bin) => Math.max(best, bin.magnitude * 2), 0);

describe('physical signal graph and socket fan-out', () => {
  it('multiplies actual 2.083 kHz and 100 kHz references to produce DSB-SC sidebands', () => {
    const project = createProject();
    connect(project, 'bottom.masterSignals', '2kHz_SINE', 'top.multiplier.upper', 'X_AC', 'red');
    connect(project, 'bottom.masterSignals', '100kHz_SINE', 'top.multiplier.upper', 'Y_AC', 'black');
    const result = simulateProject(project);
    const product = result.outputs[outputKey('top.multiplier.upper', 'kXY')];
    expect(result.errors['top.multiplier.upper']).toBeUndefined();
    expect(sidebandPeak(product, 100_000 - 2_083)).toBeGreaterThan(0.45);
    expect(sidebandPeak(product, 100_000 + 2_083)).toBeGreaterThan(0.45);
    expect(sidebandPeak(product, 100_000)).toBeLessThan(0.08);
  });

  it('fans one VCO output to two multipliers and independent CH1/CH2 probes without disconnecting branches', () => {
    const project = createProject();
    const oscillator = outputKey('bottom.vco', 'SINE');
    connect(project, 'bottom.vco', 'SINE', 'top.multiplier.upper', 'X_AC', 'red');
    connect(project, 'bottom.masterSignals', '2kHz_SINE', 'top.multiplier.upper', 'Y_AC', 'black');
    connect(project, 'bottom.vco', 'SINE', 'bottom.multiplier', 'X_DC', 'blue');
    connect(project, 'bottom.masterSignals', '2kHz_SINE', 'bottom.multiplier', 'Y_DC', 'green');
    project.instruments.scopeChannels[0].sourceKey = oscillator;
    project.instruments.scopeChannels[1].sourceKey = oscillator;
    const branchCount = project.connections.filter((edge) => edge.sourceSocketId === socketId('bottom.vco', 'SINE')).length;
    expect(branchCount).toBe(2);
    expect(project.instruments.scopeChannels.slice(0, 2).map((channel) => channel.sourceKey)).toEqual([oscillator, oscillator]);

    let result = simulateProject(project);
    const source = result.outputs[oscillator];
    const scopeInputs = project.instruments.scopeChannels.slice(0, 2).map((channel) => result.outputs[channel.sourceKey]);
    expect(branchCount + project.instruments.scopeChannels.filter((channel) => channel.enabled && channel.sourceKey === oscillator).length).toBe(4);
    expect(scopeInputs[0]).toBe(source);
    expect(scopeInputs[1]).toBe(source);
    const productA = result.outputs[outputKey('top.multiplier.upper', 'kXY')];
    const productB = result.outputs[outputKey('bottom.multiplier', 'kXY')];
    expect(result.errors).toEqual({});
    expect(source.metadata.frequency).toBe(9_000);
    expect(productA.samples).toEqual(productB.samples);
    expect(result.outputs[outputKey('bottom.masterSignals', '2kHz_SINE')].samples.length).toBe(source.samples.length);

    project.connections = project.connections.filter((edge) => !(edge.targetModuleId === 'bottom.multiplier' && edge.targetPort === 'X_DC'));
    result = simulateProject(project);
    expect(result.outputs[oscillator].samples).toEqual(source.samples);
    expect(project.instruments.scopeChannels.slice(0, 2).every((channel) => result.outputs[channel.sourceKey] === result.outputs[oscillator])).toBe(true);
    expect(result.outputs[outputKey('top.multiplier.upper', 'kXY')].samples).toEqual(productA.samples);
    expect(result.errors['bottom.multiplier']).toMatch(/X_DC/);
    expect(project.connections.filter((edge) => edge.sourceSocketId === socketId('bottom.vco', 'SINE'))).toHaveLength(1);
    expect(project.instruments.scopeChannels.slice(0, 2).map((channel) => channel.sourceKey)).toEqual([oscillator, oscillator]);
  });

  it('exposes an output fan-out as one stable source and preserves single-driver destination rules', () => {
    const project = createProject();
    connect(project, 'bottom.masterSignals', '100kHz_SINE', 'top.multiplier.upper', 'X_AC', 'red');
    connect(project, 'bottom.masterSignals', '100kHz_SINE', 'bottom.multiplier', 'X_DC', 'black');
    expect(validateConnection(project, 'bottom.masterSignals', '100kHz_SINE', 'top.multiplier.upper', 'X_AC').ok).toBe(false);
    const duplicateInput = validateConnection(project, 'bottom.masterSignals', '2kHz_SINE', 'top.multiplier.upper', 'X_AC');
    expect(duplicateInput.ok).toBe(false);
    if (!duplicateInput.ok) expect(duplicateInput.reason).toMatch(/single-driver/i);
    expect(project.connections[0].sourceSocketId).toBe(project.connections[1].sourceSocketId);
  });

  it('rejects digital-to-analog and input-to-input patching with a useful reason', () => {
    const project = createProject();
    const digitalToAnalog = validateConnection(project, 'bottom.vco', 'DIGITAL', 'top.buffer', 'IN');
    expect(digitalToAnalog.ok).toBe(false);
    if (!digitalToAnalog.ok) expect(digitalToAnalog.reason).toMatch(/digital output to analog input/);
    const inputToInput = validateConnection(project, 'top.adder', 'A', 'top.buffer', 'IN');
    expect(inputToInput.ok).toBe(false);
    if (!inputToInput.ok) expect(inputToInput.reason).toMatch(/no output socket/);
  });

  it('rejects a feedback cycle and reports an invalid processing schedule', () => {
    const project = createProject();
    connect(project, 'top.buffer', 'OUT', 'top.adder', 'A');
    const cycle = validateConnection(project, 'top.adder', 'GA+gB', 'top.buffer', 'IN');
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) expect(cycle.reason).toMatch(/cycle/i);
    const edge: Connection = {
      id: 'deliberately-corrupt-cycle', sourceModuleId: 'top.adder', sourcePort: 'GA+gB',
      targetModuleId: 'top.buffer', targetPort: 'IN', sourceSocketId: socketId('top.adder', 'GA+gB'),
      targetSocketId: socketId('top.buffer', 'IN'), color: 'red', routing: [], state: 'active',
    };
    project.connections.push(edge);
    expect(() => topologicalOrder(project)).toThrow(/cycle/i);
    expect(simulateProject(project).errors._project).toMatch(/cycle/i);
  });

  it('reports missing active multiplier inputs and never fabricates the product', () => {
    const project = createProject();
    const out = outputKey('top.multiplier.upper', 'kXY');
    project.instruments.scopeChannels[0].sourceKey = out;
    const result = simulateProject(project);
    expect(result.errors['top.multiplier.upper']).toMatch(/X axis/);
    expect(result.outputs[out]).toBeUndefined();
  });

  it('advances absolute sample time between live windows and changes the seeded noise block', () => {
    const project = createProject();
    const first = simulateProject(project, undefined, 0);
    const referenceKey = outputKey('bottom.masterSignals', '2kHz_SINE');
    const noiseKey = outputKey('top.noise', '0dB');
    const reference = first.outputs[referenceKey];
    const halfPeriodSamples = Math.round(reference.sampleRate / (2 * reference.metadata.frequency!));
    const next = simulateProject(project, undefined, halfPeriodSamples / reference.sampleRate);
    expect(next.outputs[referenceKey].samples[500]).toBeCloseTo(-reference.samples[500], 2);
    expect(next.outputs[noiseKey].samples).not.toEqual(first.outputs[noiseKey].samples);
  });

  it('computes an actual spectrum peak at a source reference frequency', () => {
    const result = simulateProject(createProject());
    const signal = result.outputs[outputKey('bottom.masterSignals', '100kHz_SINE')];
    expect(signal.sampleRate).toBe(8_000_000);
    const bins = calculateSpectrum(signal, 'hann');
    const peak = bins.filter((bin) => bin.frequency > 0)
      .reduce((best, bin) => bin.magnitude > best.magnitude ? bin : best);
    const negativePeak = bins.filter((bin) => bin.frequency < 0)
      .reduce((best, bin) => bin.magnitude > best.magnitude ? bin : best);
    expect(peak.frequency).toBeCloseTo(100_000, -3);
    expect(negativePeak.frequency).toBeCloseTo(-peak.frequency, -3);
    expect(negativePeak.magnitude).toBeCloseTo(peak.magnitude, 8);
    expect(peak.magnitude).toBeGreaterThan(0.75);
  });
});

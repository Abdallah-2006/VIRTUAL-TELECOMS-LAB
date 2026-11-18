import { describe, expect, it } from 'vitest';
import { cablePath, cableSegments, clampToPanel, insertionPoints, normalizeRouting } from '../src/hardware/cableGeometry';
import { PANEL } from '../src/hardware/layout';
import { createProject, validateImportedProject } from '../src/project/projectFormat';
import { makeSignature } from '../src/project/signature';
import { socketId } from '../src/types';

const start = { x: 20, y: 40 };
const end = { x: 120, y: 90 };

function projectWithLead() {
  const project = createProject('Routing lab');
  project.connections.push({
    id: 'lead-routing', sourceModuleId: 'bottom.masterSignals', sourcePort: '2kHz_SINE',
    targetModuleId: 'top.multiplier.upper', targetPort: 'X_AC',
    sourceSocketId: socketId('bottom.masterSignals', '2kHz_SINE'),
    targetSocketId: socketId('top.multiplier.upper', 'X_AC'),
    color: 'red', routing: [], state: 'active',
  });
  return project;
}

describe('patch-lead routing geometry', () => {
  it('keeps both socket anchors exact for default and manually routed leads', () => {
    for (const routing of [[], [{ x: 40, y: 110 }], [{ x: 35, y: 15 }, { x: 90, y: 120 }, { x: 130, y: 30 }]]) {
      const segments = cableSegments(start, end, routing);
      expect(segments[0].p0.x).toBeCloseTo(start.x);
      expect(segments[0].p0.y).toBeCloseTo(start.y);
      expect(segments[segments.length - 1].p1.x).toBeCloseTo(end.x);
      expect(segments[segments.length - 1].p1.y).toBeCloseTo(end.y);
      const path = cablePath(start, end, routing);
      expect(path.startsWith(`M ${start.x} ${start.y}`)).toBe(true);
      expect(path.trimEnd().endsWith(` ${end.x} ${end.y}`)).toBe(true);
      expect(path).not.toMatch(/NaN|Infinity/);
    }
  });

  it('leaves the sockets horizontally regardless of where bends are dragged', () => {
    const [first] = cableSegments(start, end, [{ x: 30, y: 160 }]);
    expect(first.c1.y).toBeCloseTo(start.y);
    const last = cableSegments(start, end, [{ x: 30, y: 160 }]).at(-1)!;
    expect(last.c2.y).toBeCloseTo(end.y);
  });

  it('offers extra bend handles so complex routes can be built incrementally', () => {
    expect(insertionPoints(start, end, [])).toHaveLength(2);
    expect(insertionPoints(start, end, [{ x: 40, y: 120 }])).toHaveLength(2);
    expect(insertionPoints(start, end, [{ x: 40, y: 120 }, { x: 70, y: 20 }, { x: 100, y: 140 }])).toHaveLength(4);
  });

  it('clamps drag points onto the printed panel and validates imported routing', () => {
    expect(clampToPanel({ x: -20, y: 900 })).toEqual({ x: PANEL.left, y: PANEL.bottom });
    expect(normalizeRouting(undefined)).toEqual([]);
    expect(normalizeRouting([{ x: -4, y: 500 }])).toEqual([{ x: PANEL.left, y: PANEL.bottom }]);
    expect(() => normalizeRouting('bad')).toThrow(/array/i);
    expect(() => normalizeRouting([{ x: Number.NaN, y: 20 }])).toThrow(/finite/i);
    expect(() => normalizeRouting(Array.from({ length: 25 }, (_, index) => ({ x: index, y: index })))).toThrow(/at most/i);
  });
});

describe('cable appearance persistence', () => {
  it('round-trips cable color and manual routing through project import', () => {
    const project = projectWithLead();
    project.connections[0].color = 'blue';
    project.connections[0].routing = [{ x: 60, y: 120 }, { x: 100, y: 30 }];
    const restored = validateImportedProject(JSON.parse(JSON.stringify(project)));
    expect(restored.connections[0].color).toBe('blue');
    expect(restored.connections[0].routing).toEqual([{ x: 60, y: 120 }, { x: 100, y: 30 }]);
  });

  it('accepts older projects without routing and rejects malformed routing', () => {
    const legacy = JSON.parse(JSON.stringify(projectWithLead())) as Record<string, unknown> & { connections: Record<string, unknown>[] };
    delete legacy.connections[0].routing;
    expect(validateImportedProject(legacy).connections[0].routing).toEqual([]);

    const malformed = JSON.parse(JSON.stringify(projectWithLead())) as { connections: Record<string, unknown>[] };
    malformed.connections[0].routing = [{ x: 'left', y: 20 }];
    expect(() => validateImportedProject(malformed)).toThrow(/finite/i);
  });

  it('never marks the DSP graph stale for colour or routing-only edits', () => {
    const project = projectWithLead();
    const before = makeSignature(project);
    project.connections[0].color = 'green';
    project.connections[0].routing = [{ x: 50, y: 20 }, { x: 90, y: 150 }];
    expect(makeSignature(project)).toBe(before);

    project.connections[0].targetPort = 'Y_AC';
    project.connections[0].targetSocketId = socketId('top.multiplier.upper', 'Y_AC');
    expect(makeSignature(project)).not.toBe(before);
  });
});

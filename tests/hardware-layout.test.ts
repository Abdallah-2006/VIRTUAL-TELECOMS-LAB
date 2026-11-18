import { describe, expect, it } from 'vitest';
import { BAYS, HARDWARE_MODULES, PANEL } from '../src/hardware/layout';
import { moduleByType } from '../src/modules/registry';
import { socketId } from '../src/types';

describe('measured fixed hardware layout', () => {
  it('keeps every module and each uniquely identified socket inside the normalized panel', () => {
    const modules = new Set<string>(), sockets = new Set<string>();
    for (const layout of HARDWARE_MODULES) {
      expect(modules.has(layout.id)).toBe(false);
      modules.add(layout.id);
      expect(layout.x).toBeGreaterThanOrEqual(PANEL.left);
      expect(layout.y).toBeGreaterThanOrEqual(PANEL.top);
      expect(layout.x + layout.width).toBeLessThanOrEqual(PANEL.right);
      expect(layout.y + layout.height).toBeLessThanOrEqual(PANEL.bottom);
      const definition = moduleByType.get(layout.type)!;
      const registeredPorts = [...definition.inputs, ...definition.outputs].map((port) => port.name).sort();
      expect(layout.sockets.map((socket) => socket.port).sort()).toEqual(registeredPorts);
      for (const socket of layout.sockets) {
        expect(socket.x).toBeGreaterThan(layout.x);
        expect(socket.x).toBeLessThan(layout.x + layout.width);
        expect(socket.y).toBeGreaterThan(layout.y);
        expect(socket.y).toBeLessThan(layout.y + layout.height);
        const id = socketId(layout.id, socket.port);
        expect(sockets.has(id)).toBe(false);
        sockets.add(id);
      }
    }
  });

  it('preserves the upper/lower panel rows and the oversized optional Expansion bay', () => {
    const upper = HARDWARE_MODULES.filter((module) => module.row === 'top');
    const lower = HARDWARE_MODULES.filter((module) => module.row === 'bottom');
    expect(upper.length).toBeGreaterThan(10);
    expect(lower.length).toBeGreaterThan(10);
    const expansion = BAYS.find((bay) => bay.id === 'B8')!;
    expect(expansion.width).toBeGreaterThan(upper[0].width * 1.9);
    expect(PANEL.width / PANEL.height).toBeCloseTo(468 / 240, 2);
  });
});

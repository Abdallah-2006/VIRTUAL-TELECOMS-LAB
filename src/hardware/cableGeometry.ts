import type { CablePoint } from '../types';
import { PANEL } from './layout';

export interface CableSegment { p0: CablePoint; c1: CablePoint; c2: CablePoint; p1: CablePoint }

/** Routing is visual only; keep it on the printed panel so handles never disappear off-board. */
export const MAX_ROUTING_POINTS = 24;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function clampToPanel(point: CablePoint): CablePoint {
  return { x: clamp(point.x, PANEL.left, PANEL.right), y: clamp(point.y, PANEL.top, PANEL.bottom) };
}

/**
 * Validates routing read from a project file. Missing routing is allowed for older exports and
 * becomes the default sag; invalid data is rejected rather than silently repositioning a lead.
 */
export function normalizeRouting(value: unknown, label = 'Cable routing'): CablePoint[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of points.`);
  if (value.length > MAX_ROUTING_POINTS) throw new Error(`${label} supports at most ${MAX_ROUTING_POINTS} points.`);
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} point ${index + 1} is invalid.`);
    const { x, y } = raw as CablePoint;
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${label} point ${index + 1} must have finite x/y coordinates.`);
    return clampToPanel({ x, y });
  });
}

const bezierPoint = (segment: CableSegment, t: number): CablePoint => {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * segment.p0.x + b * segment.c1.x + c * segment.c2.x + d * segment.p1.x,
    y: a * segment.p0.y + b * segment.c1.y + c * segment.c2.y + d * segment.p1.y,
  };
};

/**
 * Cubic segments through the socket anchors and any user routing points. With no routing the
 * original single-sag curve is preserved. With routing, a cardinal spline keeps the lead smooth
 * while forcing a horizontal entry/exit at each socket so the plug never appears to kink.
 */
export function cableSegments(start: CablePoint, end: CablePoint, routing: readonly CablePoint[] = []): CableSegment[] {
  if (!routing.length) {
    const bend = Math.max(4, Math.min(28, Math.abs(end.x - start.x) * 0.42));
    const direction = end.x >= start.x ? 1 : -1;
    return [{ p0: start, c1: { x: start.x + bend * direction, y: start.y }, c2: { x: end.x - bend * direction, y: end.y }, p1: end }];
  }
  const points = [start, ...routing.map(clampToPanel), end];
  const segments: CableSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p1 = points[index];
    const p2 = points[index + 1];
    const previous = points[index - 1] ?? { x: p1.x - (p2.x - p1.x), y: p1.y };
    const following = points[index + 2] ?? { x: p2.x + (p2.x - p1.x), y: p2.y };
    segments.push({
      p0: p1,
      c1: { x: p1.x + (p2.x - previous.x) / 6, y: p1.y + (p2.y - previous.y) / 6 },
      c2: { x: p2.x - (following.x - p1.x) / 6, y: p2.y - (following.y - p1.y) / 6 },
      p1: p2,
    });
  }
  const first = segments[0];
  const firstReach = Math.max(4, Math.min(22, Math.abs(points[1].x - start.x) * 0.45 || 8));
  first.c1 = { x: start.x + (points[1].x >= start.x ? firstReach : -firstReach), y: start.y };
  const last = segments[segments.length - 1];
  const lastReach = Math.max(4, Math.min(22, Math.abs(end.x - last.p0.x) * 0.45 || 8));
  last.c2 = { x: end.x + (last.p0.x >= end.x ? lastReach : -lastReach), y: end.y };
  return segments;
}

export function segmentsToPath(segments: readonly CableSegment[]): string {
  return segments.map((segment, index) => {
    const move = index === 0 ? `M ${round(segment.p0.x)} ${round(segment.p0.y)} ` : '';
    return `${move}C ${round(segment.c1.x)} ${round(segment.c1.y)}, ${round(segment.c2.x)} ${round(segment.c2.y)}, ${round(segment.p1.x)} ${round(segment.p1.y)}`;
  }).join(' ');
}

const round = (value: number) => Number(value.toFixed(3));

export function cablePath(start: CablePoint, end: CablePoint, routing: readonly CablePoint[] = []): string {
  return segmentsToPath(cableSegments(start, end, routing));
}

/**
 * Hollow "add a bend" handles: a fresh lead offers two, an already-routed lead offers one per
 * segment so extra control points can be inserted anywhere along the run.
 */
export function insertionPoints(start: CablePoint, end: CablePoint, routing: readonly CablePoint[] = []): CablePoint[] {
  const segments = cableSegments(start, end, routing);
  if (!routing.length) return [bezierPoint(segments[0], 1 / 3), bezierPoint(segments[0], 2 / 3)].map(clampToPanel);
  return segments.map((segment) => clampToPanel(bezierPoint(segment, 0.5)));
}

export function bendPoint(segment: CableSegment, t = 0.5): CablePoint {
  return bezierPoint(segment, t);
}

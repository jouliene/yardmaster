import type { Interval, Layout, Segment, Vec } from './types';

export const EPS = 1e-7;
export const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const length = (s: Segment) => s.geometry.slice(1).reduce((sum, p, i) => sum + distance(s.geometry[i], p), 0);
export const spanLength = (s: Interval) => Math.abs(s.to - s.from);
export const pathLength = (path: Interval[]) => path.reduce((sum, s) => sum + spanLength(s), 0);
export function pointAt(s: Segment, at: number): Vec {
  let remaining = Math.max(0, Math.min(length(s), at));
  for (let i = 1; i < s.geometry.length; i++) {
    const a = s.geometry[i - 1], b = s.geometry[i], d = distance(a, b);
    if (remaining <= d || i === s.geometry.length - 1) {
      const t = d ? Math.min(1, remaining / d) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= d;
  }
  return s.geometry[0];
}
export function project(s: Segment, p: Vec): { at: number; distance: number } {
  let offset = 0, best = { at: 0, distance: Infinity };
  for (let i = 1; i < s.geometry.length; i++) {
    const a = s.geometry[i - 1], b = s.geometry[i], d = distance(a, b);
    const t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (d * d))) : 0;
    const gap = distance(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (gap < best.distance) best = { at: offset + t * d, distance: gap };
    offset += d;
  }
  return best;
}
export const reversePath = (path: Interval[]): Interval[] => [...path].reverse().map(s => ({ segment: s.segment, from: s.to, to: s.from }));
export function cutPath(path: Interval[], start: number, end: number): Interval[] {
  const result: Interval[] = [];
  let offset = 0;
  for (const s of path) {
    const n = spanLength(s), a = Math.max(start, offset), b = Math.min(end, offset + n);
    if (b > a + EPS) {
      const sign = Math.sign(s.to - s.from);
      const next = { segment: s.segment, from: s.from + sign * (a - offset), to: s.from + sign * (b - offset) };
      const last = result.at(-1);
      if (last && last.segment === next.segment && Math.abs(last.to - next.from) < EPS && Math.sign(last.to - last.from) === sign) last.to = next.to;
      else result.push(next);
    }
    offset += n;
  }
  return result;
}
export function pathPosition(path: Interval[], at: number): { segment: string; at: number } {
  let remaining = Math.max(0, Math.min(pathLength(path), at));
  for (const s of path) {
    if (remaining <= spanLength(s) + EPS) return { segment: s.segment, at: s.from + Math.sign(s.to - s.from) * remaining };
    remaining -= spanLength(s);
  }
  const last = path[path.length - 1];
  return { segment: last.segment, at: last.to };
}
export function pathPoints(layout: Layout, path: Interval[]): Vec[] {
  return path.flatMap(s => {
    const segment = layout.segments[s.segment];
    let offset = 0;
    const vertices: Vec[] = [];
    for (let i = 1; i < segment.geometry.length; i++) {
      offset += distance(segment.geometry[i - 1], segment.geometry[i]);
      if (offset > Math.min(s.from, s.to) + EPS && offset < Math.max(s.from, s.to) - EPS) vertices.push(segment.geometry[i]);
    }
    if (s.to < s.from) vertices.reverse();
    return [pointAt(segment, s.from), ...vertices, pointAt(segment, s.to)];
  });
}

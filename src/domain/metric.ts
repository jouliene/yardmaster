import { EPS, length } from './geometry';
import type { Interval, Layout, Port } from './types';

export const samePort = (a: Port, b: Port) => a.segment === b.segment && a.end === b.end;
export const nextPorts = (layout: Layout, port: Port) => layout.links.flatMap(link => samePort(link.from, port) ? [link.to] : samePort(link.to, port) ? [link.from] : []);
export const overlaps = (a: Interval, b: Interval) => a.segment === b.segment &&
  Math.max(a.from, a.to) > Math.min(b.from, b.to) + EPS && Math.min(a.from, a.to) < Math.max(b.from, b.to) - EPS;

// Extend both ends in longitudinal metres. Enter a linked port, then traverse
// its segment; never jump between sibling ports at a points toe. Geometry
// proximity and gate settings do not create/remove physical clearance space.
export function expandIntervals(layout: Layout, intervals: Interval[], margin: number): Interval[] {
  const result: Interval[] = [];
  const pending: { port: Port; remaining: number }[] = [];
  const spill = (port: Port, remaining: number) => {
    if (remaining > EPS) for (const next of nextPorts(layout, port)) pending.push({ port: next, remaining });
  };
  for (const s of intervals) {
    const n = length(layout.segments[s.segment]);
    const lo = Math.min(s.from, s.to) - margin, hi = Math.max(s.from, s.to) + margin;
    result.push({ segment: s.segment, from: Math.max(0, lo), to: Math.min(n, hi) });
    spill({ segment: s.segment, end: 'a' }, -lo);
    spill({ segment: s.segment, end: 'b' }, hi - n);
  }
  const reached = new Map<string, number>();
  for (let i = 0; i < pending.length; i++) {
    const { port, remaining } = pending[i], key = `${port.segment}:${port.end}`;
    if ((reached.get(key) ?? -Infinity) >= remaining - EPS) continue;
    reached.set(key, remaining);
    const n = length(layout.segments[port.segment]), from = port.end === 'a' ? 0 : n;
    result.push({ segment: port.segment, from, to: from + (port.end === 'a' ? 1 : -1) * Math.min(n, remaining) });
    spill({ segment: port.segment, end: port.end === 'a' ? 'b' : 'a' }, remaining - n);
  }
  return result;
}
export const pathsConflict = (layout: Layout, a: Interval[], b: Interval[], margin: number) => {
  const expanded = expandIntervals(layout, b, margin);
  return a.some(s => expanded.some(z => overlaps(s, z)));
};
export const bufferIntervals = (layout: Layout) => expandIntervals(layout, layout.buffers.map(port => {
  const at = port.end === 'a' ? 0 : length(layout.segments[port.segment]);
  return { segment: port.segment, from: at, to: at };
}), layout.margins.buffer);

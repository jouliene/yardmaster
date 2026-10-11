import { length } from '../domain/geometry';
import type { Layout, Link, Port, Scenario, Segment, Vec } from '../domain/types';

// Curves are explicit sampled centrelines. Both rendering and arc length use
// these same polylines; there is no separate nominal physical length.
function curve(a: Vec, b: Vec): Vec[] {
  return Array.from({ length: 41 }, (_, i) => {
    const t = i / 40, smooth = t * t * (3 - 2 * t);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * smooth };
  });
}
const straight = (id: string, label: string, a: Vec, b: Vec): Segment => ({ id, label, geometry: [a, b] });
const segments: Record<string, Segment> = Object.fromEntries([
  straight('H', 'H · Headshunt', { x: -180, y: 0 }, { x: 0, y: 0 }),
  { ...straight('P01N', 'P01 normal', { x: 0, y: 0 }, { x: 40, y: 0 }), gate: { points: 'P01', position: 'normal' as const } },
  { id: 'P01R', label: 'P01 reverse', geometry: curve({ x: 0, y: 0 }, { x: 40, y: 36 }), gate: { points: 'P01', position: 'reverse' as const } },
  straight('R1', 'R1 · Arrival', { x: 40, y: 0 }, { x: 330, y: 0 }),
  straight('L', 'L · Ladder', { x: 40, y: 36 }, { x: 70, y: 36 }),
  { ...straight('P02N', 'P02 normal', { x: 70, y: 36 }, { x: 110, y: 36 }), gate: { points: 'P02', position: 'normal' as const } },
  { id: 'P02R', label: 'P02 reverse', geometry: curve({ x: 70, y: 36 }, { x: 110, y: 72 }), gate: { points: 'P02', position: 'reverse' as const } },
  straight('R2', 'R2 · Sorting', { x: 110, y: 36 }, { x: 330, y: 36 }),
  straight('R3', 'R3 · Stabling', { x: 110, y: 72 }, { x: 330, y: 72 }),
].map(s => [s.id, s]));
const port = (segment: string, end: 'a' | 'b'): Port => ({ segment, end });
const link = (a: string, ae: 'a' | 'b', b: string, be: 'a' | 'b'): Link => ({ from: port(a, ae), to: port(b, be) });
const full = (segment: string) => ({ segment, from: 0, to: length(segments[segment]) });
export const yard: Layout = {
  segments,
  links: [link('H', 'b', 'P01N', 'a'), link('H', 'b', 'P01R', 'a'), link('P01N', 'b', 'R1', 'a'), link('P01R', 'b', 'L', 'a'), link('L', 'b', 'P02N', 'a'), link('L', 'b', 'P02R', 'a'), link('P02N', 'b', 'R2', 'a'), link('P02R', 'b', 'R3', 'a')],
  points: {
    P01: { id: 'P01', at: { x: 0, y: 0 }, zone: [{ segment: 'H', from: 170, to: 180 }, full('P01N'), full('P01R'), { segment: 'R1', from: 0, to: 8 }, { segment: 'L', from: 0, to: 8 }] },
    P02: { id: 'P02', at: { x: 70, y: 36 }, zone: [{ segment: 'L', from: 22, to: 30 }, full('P02N'), full('P02R'), { segment: 'R2', from: 0, to: 8 }, { segment: 'R3', from: 0, to: 8 }] },
  },
  buffers: [port('H', 'a'), port('R1', 'b'), port('R2', 'b'), port('R3', 'b')],
  margins: { train: 3, points: 5, buffer: 5 },
};
export const presets = [
  { id: 'shunt', label: '01 · Reversing shunt', hint: 'Clear P01 into the headshunt, set P01 to Reverse, reverse T01, then enter R2.' },
  { id: 'blocked', label: '02 · Occupied route', hint: 'T02 blocks the headshunt. A long move must stop before it, even when the destination is beyond it.' },
  { id: 'short', label: '03 · Not enough room', hint: 'T02 leaves only 70 m beyond the P01 boundary. T01 needs 80 m: a 10 m shortfall.' },
];
export function makeScenario(id = 'shunt'): Scenario {
  return {
    id, points: { P01: 'normal', P02: 'normal' },
    trains: [
      { id: 'T01', sections: [1, 2, 3].map(n => ({ id: `T01-${n}`, length: 25 })), path: [{ segment: 'R1', from: 95, to: 20 }], leading: 'A' },
      { id: 'T02', sections: [1, 2].map(n => ({ id: `T02-${n}`, length: 20 })), path: id === 'shunt' ? [{ segment: 'R3', from: 160, to: 200 }] : [{ segment: 'H', from: id === 'short' ? 57 : 87, to: id === 'short' ? 97 : 127 }], leading: 'A' },
    ],
  };
}

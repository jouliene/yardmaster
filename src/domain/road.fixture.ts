import type { Destination, Interval, Layout, Scenario } from './types';

// The scalar coordinate is distance along the road, independent of segmentation.
export function road(cuts = [0, 200], reversed: boolean | number[] = false) {
  const flipped = (i: number) => Array.isArray(reversed) ? reversed.includes(i) : reversed;
  const layout: Layout = { segments: {}, links: [], points: {}, buffers: [], margins: { train: 3, points: 5, buffer: 5 } };
  cuts.slice(1).forEach((end, i) => {
    const id = `S${i}`, geometry = [{ x: cuts[i], y: 0 }, { x: end, y: 0 }];
    layout.segments[id] = { id, label: id, geometry: flipped(i) ? geometry.reverse() : geometry };
    if (i) layout.links.push({ from: { segment: `S${i - 1}`, end: flipped(i - 1) ? 'a' : 'b' }, to: { segment: id, end: flipped(i) ? 'b' : 'a' } });
  });
  const destination = (at: number): Destination => {
    const i = Math.max(0, cuts.slice(1).findIndex(end => at <= end));
    return { segment: `S${i}`, at: flipped(i) ? cuts[i + 1] - at : at - cuts[i] };
  };
  const path = (from: number, to: number): Interval[] => {
    const slices = cuts.slice(1).flatMap((end, i) => {
      const lo = Math.max(Math.min(from, to), cuts[i]), hi = Math.min(Math.max(from, to), end);
      if (hi <= lo) return [];
      const local = (at: number) => flipped(i) ? end - at : at - cuts[i];
      return [{ segment: `S${i}`, from: local(from < to ? lo : hi), to: local(from < to ? hi : lo) }];
    });
    return from < to ? slices : slices.reverse();
  };
  const scenario = (a = 80, b = 90, c = 101, d = 111): Scenario => ({ id: 'road', points: {}, trains: [
    { id: 'moving', leading: 'A', sections: [{ id: 'm', length: Math.abs(b - a) }], path: path(a, b) },
    { id: 'parked', leading: 'A', sections: [{ id: 'p', length: Math.abs(d - c) }], path: path(c, d) },
  ] });
  return { layout, path, destination, scenario };
}


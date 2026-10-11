import { distance, EPS, length, pathLength } from './geometry';
import { bufferIntervals, nextPorts, overlaps, pathsConflict, samePort } from './metric';
import type { Interval, Layout, Port, Scenario, Segment } from './types';

export const ENDPOINT_TOLERANCE = 1e-6; // metres; authored endpoint coincidence only
export const METRIC_TOLERANCE = EPS; // metres; interval bounds, lengths and equality
export interface Diagnostic { code: string; message: string; path: string; entityId?: string }
export type Validation<T> = { valid: true; value: T; diagnostics: [] } | { valid: false; diagnostics: Diagnostic[] };
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v);
const position = (v: unknown) => v === 'normal' || v === 'reverse';
const vector = (v: unknown) => record(v) && finite(v.x) && finite(v.y);
const own = (r: object, key: string) => Object.hasOwn(r, key);
const finish = <T>(value: unknown, diagnostics: Diagnostic[]): Validation<T> => diagnostics.length ? { valid: false, diagnostics } : { valid: true, value: value as T, diagnostics: [] };
const reporter = (diagnostics: Diagnostic[]) => (code: string, path: string, message: string, entityId?: string) => diagnostics.push({ code, path, message, ...(entityId === undefined ? {} : { entityId }) });
type Report = ReturnType<typeof reporter>;

function checkPort(value: unknown, segments: Record<string, Segment>, path: string, report: Report): value is Port {
  if (!record(value) || typeof value.segment !== 'string' || !own(segments, value.segment) || (value.end !== 'a' && value.end !== 'b')) {
    report('port.invalid', path, 'A port must reference an existing segment and end a or b.'); return false;
  }
  return true;
}
function checkInterval(value: unknown, segments: Record<string, Segment>, path: string, report: Report, entityId: string): value is Interval {
  if (!record(value) || typeof value.segment !== 'string' || !own(segments, value.segment)) {
    report('interval.reference', path, 'Interval must reference an existing segment.', entityId); return false;
  }
  if (!finite(value.from) || !finite(value.to)) {
    report('interval.nonfinite', path, 'Interval endpoints must be finite metres.', entityId); return false;
  }
  const n = length(segments[value.segment]);
  if (Math.min(value.from, value.to) < -EPS || Math.max(value.from, value.to) > n + EPS || Math.abs(value.to - value.from) <= EPS) {
    report('interval.bounds', path, 'Interval must have positive length and lie within its segment.', entityId); return false;
  }
  return true;
}

export function validateLayout(input: unknown): Validation<Layout> {
  const diagnostics: Diagnostic[] = [], report = reporter(diagnostics);
  if (!record(input)) { report('layout.shape', 'layout', 'Layout must be an object.'); return finish(input, diagnostics); }
  for (const field of ['segments', 'points', 'margins']) if (!record(input[field])) report('layout.shape', `layout.${field}`, `${field} must be an object.`);
  for (const field of ['links', 'buffers']) if (!Array.isArray(input[field])) report('layout.shape', `layout.${field}`, `${field} must be an array.`);
  if (diagnostics.length) return finish(input, diagnostics);
  const segments = input.segments as Record<string, unknown>, points = input.points as Record<string, unknown>;
  const margins = input.margins as Record<string, unknown>;
  if (!Object.keys(segments).length) report('layout.empty', 'layout.segments', 'At least one segment is required.');
  for (const field of ['train', 'points', 'buffer']) if (!finite(margins[field]) || margins[field] < 0) report('margin.invalid', `layout.margins.${field}`, 'Margin must be finite and non-negative.');
  for (const [id, raw] of Object.entries(segments)) {
    const path = `layout.segments.${id}`;
    if (!record(raw)) { report('segment.shape', path, 'Segment must be an object.', id); continue; }
    if (!identifier(id) || raw.id !== id) report('id.invalid', `${path}.id`, 'Segment ID must match its valid record key.', id);
    if (typeof raw.label !== 'string' || !raw.label.trim()) report('segment.label', `${path}.label`, 'Segment needs a readable label.', id);
    if (!Array.isArray(raw.geometry) || raw.geometry.length < 2 || !Array.from(raw.geometry).every(vector)) {
      report('geometry.invalid', `${path}.geometry`, 'Geometry needs at least two finite x/y points.', id);
    } else {
      const n = length(raw as unknown as Segment);
      if (!Number.isFinite(n) || n <= EPS) report('geometry.length', `${path}.geometry`, 'Segment must have a finite positive metric length.', id);
      if (raw.geometry.some((p, i, all) => i > 0 && distance(p, all[i - 1]) <= EPS)) report('geometry.edge', `${path}.geometry`, 'Consecutive geometry vertices must be distinct.', id);
    }
    if (raw.gate !== undefined && (!record(raw.gate) || typeof raw.gate.points !== 'string' || !own(points, raw.gate.points) || !position(raw.gate.position))) {
      report('gate.invalid', `${path}.gate`, 'Gate must reference existing points and position normal or reverse.', id);
    }
  }
  for (const [id, raw] of Object.entries(points)) {
    const path = `layout.points.${id}`;
    if (!record(raw)) { report('points.shape', path, 'Points must be an object.', id); continue; }
    if (!identifier(id) || raw.id !== id) report('id.invalid', `${path}.id`, 'Points ID must match its valid record key.', id);
    if (!vector(raw.at)) report('points.location', `${path}.at`, 'Points location must contain finite x/y metres.', id);
    if (!Array.isArray(raw.zone) || !raw.zone.length) report('zone.empty', `${path}.zone`, 'Points need an explicit non-empty fouling zone.', id);
  }
  // No geometry/topology helpers see malformed objects.
  if (diagnostics.length) return finish(input, diagnostics);
  const layout = input as unknown as Layout;
  for (const [i, link] of (input.links as unknown[]).entries()) {
    const path = `layout.links[${i}]`;
    if (!record(link)) { report('link.shape', path, 'Link must have from and to ports.'); continue; }
    checkPort(link.from, layout.segments, `${path}.from`, report);
    checkPort(link.to, layout.segments, `${path}.to`, report);
  }
  for (const [i, port] of (input.buffers as unknown[]).entries()) checkPort(port, layout.segments, `layout.buffers[${i}]`, report);
  for (const points of Object.values(layout.points)) Array.from(points.zone).forEach((z, i) => checkInterval(z, layout.segments, `layout.points.${points.id}.zone[${i}]`, report, points.id));
  if (diagnostics.length) return finish(input, diagnostics);

  const portKey = (p: Port) => `${p.segment}:${p.end}`;
  const endpoint = (p: Port) => p.end === 'a' ? layout.segments[p.segment].geometry[0] : layout.segments[p.segment].geometry.at(-1)!;
  const links = new Set<string>(), ports = new Map<string, Port>();
  // Union-find rejects every undirected cycle, including parallel connections.
  const parent = new Map(Object.keys(layout.segments).map(id => [id, id]));
  const root = (id: string): string => { while (parent.get(id) !== id) id = parent.get(id)!; return id; };
  layout.links.forEach((link, i) => {
    const path = `layout.links[${i}]`, key = [portKey(link.from), portKey(link.to)].sort().join('|');
    if (links.has(key)) report('link.duplicate', path, 'Duplicate endpoint link, including a reversed duplicate.');
    links.add(key); ports.set(portKey(link.from), link.from); ports.set(portKey(link.to), link.to);
    if (link.from.segment === link.to.segment) report('link.self', path, 'A segment cannot link to itself.');
    if (distance(endpoint(link.from), endpoint(link.to)) > ENDPOINT_TOLERANCE) report('link.geometry', path, `Linked endpoints must coincide within ${ENDPOINT_TOLERANCE} m.`);
    const a = root(link.from.segment), b = root(link.to.segment);
    if (a === b) report('topology.cycle', path, 'Cyclic/parallel track connections are unsupported.'); else parent.set(a, b);
  });
  for (const port of ports.values()) {
    const next = nextPorts(layout, port);
    if (next.length <= 1) continue;
    const gates = next.map(p => layout.segments[p.segment].gate);
    if (next.length !== 2 || layout.segments[port.segment].gate || !gates[0] || !gates[1] || gates[0].points !== gates[1].points || gates[0].position === gates[1].position) {
      report('topology.ambiguous', `layout.segments.${port.segment}`, 'A branching port must feed exactly the normal and reverse routes of one points object.', port.segment);
    }
  }
  const buffers = new Set<string>();
  layout.buffers.forEach((port, i) => {
    const path = `layout.buffers[${i}]`, key = portKey(port);
    if (buffers.has(key)) report('buffer.duplicate', path, 'Duplicate buffer port.', port.segment);
    buffers.add(key);
    if (nextPorts(layout, port).length) report('buffer.connected', path, 'A buffer port cannot also be a through connection.', port.segment);
  });
  for (const points of Object.values(layout.points)) {
    const path = `layout.points.${points.id}`, routes = Object.values(layout.segments).filter(s => s.gate?.points === points.id);
    if (routes.length !== 2 || new Set(routes.map(s => s.gate!.position)).size !== 2) {
      report('points.routes', path, 'Supported points need exactly one normal and one reverse gated segment.', points.id); continue;
    }
    const toes = [...ports.values()].filter(p => {
      const next = nextPorts(layout, p);
      return !layout.segments[p.segment].gate && next.length === 2 && routes.every(s => next.some(n => n.segment === s.id));
    });
    if (toes.length !== 1) { report('points.toe', path, 'The two gated routes must share exactly one ungated toe port.', points.id); continue; }
    const toe = toes[0];
    if (distance(points.at, endpoint(toe)) > ENDPOINT_TOLERANCE) report('points.location', `${path}.at`, 'Points marker must coincide with its common toe.', points.id);
    const adjoining: Port[] = [toe];
    for (const route of routes) {
      const entry = nextPorts(layout, toe).find(p => p.segment === route.id)!;
      const exit: Port = { segment: route.id, end: entry.end === 'a' ? 'b' : 'a' };
      const neighbours = nextPorts(layout, exit);
      if (neighbours.length !== 1 || layout.segments[neighbours[0].segment].gate) report('points.branch', path, 'Each gated route must exit onto one ungated adjoining segment.', points.id);
      else adjoining.push(neighbours[0]);
      const coverage = points.zone.filter(z => z.segment === route.id).map(z => [Math.min(z.from, z.to), Math.max(z.from, z.to)]).sort((a, b) => a[0] - b[0]);
      let end = 0;
      for (const [lo, hi] of coverage) { if (lo > end + EPS) break; end = Math.max(end, hi); }
      if (end < length(route) - EPS) report('zone.route_coverage', `${path}.zone`, `Zone must cover the entire gated route ${route.id}.`, points.id);
    }
    for (const port of adjoining) {
      const at = port.end === 'a' ? 0 : length(layout.segments[port.segment]);
      if (!points.zone.some(z => z.segment === port.segment && Math.min(z.from, z.to) <= at + EPS && Math.max(z.from, z.to) >= at - EPS)) {
        report('zone.adjoining_coverage', `${path}.zone`, `Zone needs an authored positive fouling interval adjoining ${port.segment}:${port.end}.`, points.id);
      }
    }
  }
  return finish(input, diagnostics);
}

// Public boundary accepts unknown data, including an invalid layout. Semantic
// checks run only after shape, reference and numeric checks have succeeded.
export function validateScenario(layoutInput: unknown, input: unknown): Validation<Scenario> {
  const layoutResult = validateLayout(layoutInput);
  if (!layoutResult.valid) return { valid: false, diagnostics: layoutResult.diagnostics };
  return validateScenarioInLayout(layoutResult.value, input);
}
function validateScenarioInLayout(layout: Layout, input: unknown): Validation<Scenario> {
  const diagnostics: Diagnostic[] = [], report = reporter(diagnostics);
  if (!record(input)) { report('scenario.shape', 'scenario', 'Scenario must be an object.'); return finish(input, diagnostics); }
  if (!identifier(input.id)) report('id.invalid', 'scenario.id', 'Scenario needs a valid identifier.');
  if (!Array.isArray(input.trains)) report('scenario.shape', 'scenario.trains', 'Trains must be an array.');
  if (!record(input.points)) report('scenario.shape', 'scenario.points', 'Points states must be an object.');
  if (diagnostics.length) return finish(input, diagnostics);
  const states = input.points as Record<string, unknown>;
  for (const id of Object.keys(layout.points)) if (!own(states, id) || !position(states[id])) report('points.state', `scenario.points.${id}`, 'Every points object needs state normal or reverse.', id);
  for (const id of Object.keys(states)) if (!own(layout.points, id)) report('points.reference', `scenario.points.${id}`, 'Unknown points state reference.', id);
  const trainIds = new Set<string>(), sectionIds = new Set<string>();
  for (const [i, raw] of (input.trains as unknown[]).entries()) {
    const path = `scenario.trains[${i}]`;
    if (!record(raw)) { report('train.shape', path, 'Train must be an object.'); continue; }
    const id = typeof raw.id === 'string' ? raw.id : undefined;
    if (!identifier(raw.id) || trainIds.has(raw.id)) report('train.id', `${path}.id`, 'Train IDs must be valid and unique.', id);
    if (id !== undefined) trainIds.add(id);
    if (raw.leading !== 'A' && raw.leading !== 'B') report('train.leading', `${path}.leading`, 'Leading end must be A or B.', id);
    if (!Array.isArray(raw.sections) || !raw.sections.length) report('train.sections', `${path}.sections`, 'Train needs at least one section.', id);
    else Array.from(raw.sections).forEach((section, j) => {
      const sp = `${path}.sections[${j}]`;
      if (!record(section)) { report('section.shape', sp, 'Section must be an object.', id); return; }
      if (!identifier(section.id) || sectionIds.has(section.id)) report('section.id', `${sp}.id`, 'Section IDs must be valid and globally unique.', id);
      if (typeof section.id === 'string') sectionIds.add(section.id);
      if (!finite(section.length) || section.length <= EPS) report('section.length', `${sp}.length`, 'Section length must be finite and positive.', id);
    });
    if (!Array.isArray(raw.path) || !raw.path.length) report('train.path', `${path}.path`, 'Train needs a non-empty directed occupied path.', id);
    else Array.from(raw.path).forEach((slice, j) => checkInterval(slice, layout.segments, `${path}.path[${j}]`, report, id ?? path));
  }
  if (diagnostics.length) return finish(input, diagnostics);
  const scenario = input as unknown as Scenario;
  const bufferZones = bufferIntervals(layout);
  scenario.trains.forEach((train, i) => {
    const path = `scenario.trains[${i}]`, sum = train.sections.reduce((n, s) => n + s.length, 0);
    if (!Number.isFinite(sum) || Math.abs(pathLength(train.path) - sum) > METRIC_TOLERANCE) report('train.length', path, 'Occupied path length must equal the sum of section lengths.', train.id);
    const visited = new Set<string>();
    train.path.forEach((slice, j) => {
      const sp = `${path}.path[${j}]`, segment = layout.segments[slice.segment], sign = Math.sign(slice.to - slice.from);
      if (segment.gate && scenario.points[segment.gate.points] !== segment.gate.position) report('train.gate', sp, `Occupied gate requires ${segment.gate.points} ${segment.gate.position}.`, train.id);
      const previous = train.path[j - 1];
      if (previous) {
        if (previous.segment === slice.segment) {
          if (Math.abs(previous.to - slice.from) > EPS || Math.sign(previous.to - previous.from) !== sign) report('train.continuity', sp, 'Successive slices must meet and keep their direction.', train.id);
        } else {
          const exit: Port = { segment: previous.segment, end: previous.to > previous.from ? 'b' : 'a' };
          const entry: Port = { segment: slice.segment, end: sign > 0 ? 'a' : 'b' };
          const exitAt = exit.end === 'a' ? 0 : length(layout.segments[exit.segment]), entryAt = entry.end === 'a' ? 0 : length(segment);
          if (Math.abs(previous.to - exitAt) > EPS || Math.abs(slice.from - entryAt) > EPS || !nextPorts(layout, exit).some(p => samePort(p, entry))) report('train.continuity', sp, 'Occupied path must traverse explicitly linked endpoints in order.', train.id);
          if (visited.has(slice.segment)) report('train.repeated_segment', sp, 'Occupied paths cannot revisit a segment.', train.id);
        }
      }
      visited.add(slice.segment);
    });
    if (train.path.some(s => bufferZones.some(z => overlaps(s, z)))) report('train.buffer', path, 'Train occupies the configured buffer allowance.', train.id);
    for (const other of scenario.trains.slice(0, i)) {
      if (pathsConflict(layout, train.path, other.path, 0)) report('train.overlap', path, `Train overlaps ${other.id}.`, train.id);
      else if (pathsConflict(layout, train.path, other.path, layout.margins.train)) report('train.separation', path, `Train is less than ${layout.margins.train} m from ${other.id} along connected track.`, train.id);
    }
  });
  for (const points of Object.values(layout.points)) {
    const occupants = scenario.trains.filter(t => pathsConflict(layout, t.path, points.zone, layout.margins.points));
    if (occupants.length > 1) report('points.conflict', `scenario.points.${points.id}`, `Shared fouling zone contains multiple trains: ${occupants.map(t => t.id).join(', ')}.`, points.id);
  }
  return finish(input, diagnostics);
}

export function validateActivation(layout: unknown, scenario: unknown): Validation<{ layout: Layout; scenario: Scenario }> {
  const checkedLayout = validateLayout(layout);
  if (!checkedLayout.valid) return checkedLayout;
  const checkedScenario = validateScenarioInLayout(checkedLayout.value, scenario);
  if (!checkedScenario.valid) return checkedScenario;
  return { valid: true, value: { layout: checkedLayout.value, scenario: checkedScenario.value }, diagnostics: [] };
}
export const describeDiagnostics = (diagnostics: Diagnostic[]) => diagnostics.map(d => `${d.path}: ${d.message} [${d.code}]`).join('\n');

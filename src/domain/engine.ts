import { cutPath, distance, EPS, length, pathLength, pathPosition, pointAt, project, reversePath, spanLength } from './geometry';
import type { Destination, Interval, Layout, Port, Scenario, Train, Vec } from './types';

export const trainLength = (train: Train) => train.sections.reduce((sum, s) => sum + s.length, 0);
export const travelPath = (train: Train) => train.leading === 'A' ? train.path : reversePath(train.path);
export const lead = (train: Train): Destination => pathPosition(travelPath(train), trainLength(train));
export const trailing = (train: Train): Destination => pathPosition(travelPath(train), 0);
const samePort = (a: Port, b: Port) => a.segment === b.segment && a.end === b.end;
const nextPorts = (layout: Layout, port: Port) => layout.links.flatMap(link => samePort(link.from, port) ? [link.to] : samePort(link.to, port) ? [link.from] : []);
const min = (s: Interval) => Math.min(s.from, s.to);
const max = (s: Interval) => Math.max(s.from, s.to);
export const overlaps = (a: Interval, b: Interval, margin = 0) => a.segment === b.segment && max(a) > min(b) - margin + EPS && min(a) < max(b) + margin - EPS;

export function pointsOccupants(layout: Layout, scenario: Scenario, pointsId: string): string[] {
  return scenario.trains.filter(train => train.path.some(s => layout.points[pointsId].zone.some(z => overlaps(s, z, layout.margins.points)))).map(t => t.id);
}
export function changePoints(layout: Layout, scenario: Scenario, pointsId: string): { scenario: Scenario; error?: string } {
  const occupants = pointsOccupants(layout, scenario, pointsId);
  if (occupants.length) return { scenario, error: `Points ${pointsId} remain occupied by ${occupants.join(', ')} (including the ${layout.margins.points} m margin).` };
  return { scenario: { ...scenario, points: { ...scenario.points, [pointsId]: scenario.points[pointsId] === 'normal' ? 'reverse' : 'normal' } } };
}
export function reverseTrain(scenario: Scenario, trainId: string): Scenario {
  return { ...scenario, trains: scenario.trains.map(t => t.id === trainId ? { ...t, leading: t.leading === 'A' ? 'B' : 'A' } : t) };
}
// Cab selection is derived from a proposed movement, never a separate UI action.
export function withMovementDirection(scenario: Scenario, trainId: string, leading: Train['leading']): Scenario {
  return scenario.trains.find(t => t.id === trainId)!.leading === leading ? scenario : reverseTrain(scenario, trainId);
}

// Search the explicitly linked graph in the active direction, ignoring gates
// only to explain a requested route. Validation below never changes a gate.
function findRoute(layout: Layout, train: Train, target: Destination): Interval[] | undefined {
  const last = travelPath(train).at(-1)!;
  const walk = (segment: string, at: number, sign: number, visited: Set<string>): Interval[] | undefined => {
    const key = `${segment}:${sign}`;
    if (visited.has(key)) return undefined;
    const seen = new Set(visited).add(key), n = length(layout.segments[segment]);
    if (segment === target.segment && sign * (target.at - at) >= -EPS && target.at >= -EPS && target.at <= n + EPS) return [{ segment, from: at, to: target.at }];
    const end = sign > 0 ? n : 0, prefix = { segment, from: at, to: end };
    for (const port of nextPorts(layout, { segment, end: sign > 0 ? 'b' : 'a' })) {
      const next = walk(port.segment, port.end === 'a' ? 0 : length(layout.segments[port.segment]), port.end === 'a' ? 1 : -1, seen);
      if (next) return [prefix, ...next];
    }
    return undefined;
  };
  return walk(last.segment, last.to, Math.sign(last.to - last.from), new Set());
}
export interface Route { path: Interval[]; distance: number; reason: string }
export function forwardRoute(layout: Layout, scenario: Scenario, train: Train): Route {
  const last = travelPath(train).at(-1)!;
  let segment = last.segment, at = last.to, sign = Math.sign(last.to - last.from);
  const path: Interval[] = [], seen = new Set<string>();
  for (;;) {
    const key = `${segment}:${sign}`;
    if (seen.has(key)) return { path, distance: pathLength(path), reason: 'Route loop reached; choose a nearer destination.' };
    seen.add(key);
    const s = layout.segments[segment];
    if (s.gate && scenario.points[s.gate.points] !== s.gate.position) return { path, distance: pathLength(path), reason: `Points ${s.gate.points} are set to the other route.` };
    const end = sign > 0 ? length(s) : 0;
    const terminal = { segment, end: sign > 0 ? 'b' as const : 'a' as const };
    const buffer = layout.buffers.some(b => samePort(b, terminal));
    const to = buffer ? end - sign * layout.margins.buffer : end;
    if (sign * (to - at) > EPS) path.push({ segment, from: at, to });
    if (buffer) return { path, distance: pathLength(path), reason: `Buffer stop on ${segment}: ${layout.margins.buffer} m allowance already included.` };
    const ports = nextPorts(layout, terminal);
    const permitted = ports.find(p => {
      const gate = layout.segments[p.segment].gate;
      return !gate || scenario.points[gate.points] === gate.position;
    });
    if (!permitted) {
      const gate = ports.map(p => layout.segments[p.segment].gate).find(Boolean);
      return { path, distance: pathLength(path), reason: gate ? `Points ${gate.points} are set to the other route.` : `End of connected track on ${segment}.` };
    }
    segment = permitted.segment; sign = permitted.end === 'a' ? 1 : -1; at = sign > 0 ? 0 : length(layout.segments[segment]);
  }
}

// Distance at which a moving leading end first enters an interval. Analytical
// interval intersection protects against tunnelling at any frame/pointer step.
function firstEntry(path: Interval[], interval: Interval, margin = 0): number | undefined {
  let offset = 0;
  for (const s of path) {
    if (s.segment === interval.segment) {
      const sign = Math.sign(s.to - s.from) || 1;
      const a = sign > 0 ? min(interval) - margin : max(interval) + margin;
      const b = sign > 0 ? max(interval) + margin : min(interval) - margin;
      const enter = Math.max(0, sign * (a - s.from));
      const leave = Math.min(spanLength(s), sign * (b - s.from));
      if (leave > enter + EPS) return offset + enter;
    }
    offset += spanLength(s);
  }
  return undefined;
}
export interface Limit { distance: number; reason: string }
export function obstructionLimit(layout: Layout, scenario: Scenario, train: Train, route: Interval[], initial: Limit): Limit {
  let result = initial;
  const consider = (distance: number | undefined, reason: string) => {
    if (distance !== undefined && distance < result.distance - EPS) result = { distance, reason };
  };
  for (const other of scenario.trains.filter(t => t.id !== train.id)) {
    for (const interval of other.path) consider(firstEntry(route, interval, layout.margins.train), `Train ${other.id} occupies the required interval on ${interval.segment} (${layout.margins.train} m clearance).`);
    for (const points of Object.values(layout.points)) {
      if (!other.path.some(s => points.zone.some(z => overlaps(s, z, layout.margins.points)))) continue;
      for (const zone of points.zone) consider(firstEntry(route, zone, layout.margins.points), `Train ${other.id} occupies the fouling/clearance zone of points ${points.id}.`);
    }
  }
  return result;
}
export function availableMovement(layout: Layout, scenario: Scenario, train: Train) {
  const route = forwardRoute(layout, scenario, train);
  const limit = obstructionLimit(layout, scenario, train, route.path, route);
  return { ...limit, path: route.path };
}
function projectOntoPath(layout: Layout, path: Interval[], pointer: Vec): number {
  let offset = 0, bestDistance = Infinity, bestAt = 0;
  for (const slice of path) {
    const segment = layout.segments[slice.segment];
    const at = Math.max(min(slice), Math.min(max(slice), project(segment, pointer).at));
    const gap = distance(pointAt(segment, at), pointer);
    if (gap < bestDistance) { bestDistance = gap; bestAt = offset + Math.abs(at - slice.from); }
    offset += spanLength(slice);
  }
  return bestAt;
}
// Project longitudinal grab displacement only onto this train's permitted route.
export function dragTarget(layout: Layout, scenario: Scenario, trainId: string, grab: Vec, pointer: Vec): Destination {
  const train = scenario.trains.find(t => t.id === trainId)!;
  const occupied = travelPath(train), forward = forwardRoute(layout, scenario, train);
  const grabbedAt = projectOntoPath(layout, occupied, grab);
  const pointerAt = projectOntoPath(layout, [...occupied, ...forward.path], pointer);
  const advance = Math.max(0, Math.min(forward.distance, pointerAt - grabbedAt));
  return forward.path.length && advance > EPS ? pathPosition(forward.path, advance) : lead(train);
}
export interface Movement {
  valid: boolean; reason: string; distance: number; path: Interval[]; stop: Destination;
  trainId: string; leading: Train['leading']; source: Scenario; result?: Scenario;
}
export function advanceTrain(train: Train, extension: Interval[], distance: number): Train {
  const travel = travelPath(train), total = trainLength(train);
  const moved = cutPath([...travel, ...extension], distance, distance + total);
  return { ...train, path: train.leading === 'A' ? moved : reversePath(moved) };
}
export function scenarioAtMovement(movement: Movement, distance: number): Scenario {
  const step = Math.max(0, Math.min(distance, movement.distance));
  return { ...movement.source, trains: movement.source.trains.map(t => t.id === movement.trainId ? advanceTrain({ ...t, leading: movement.leading }, movement.path, step) : t) };
}
export function validateMove(layout: Layout, scenario: Scenario, trainId: string, target: Destination): Movement {
  const train = scenario.trains.find(t => t.id === trainId)!;
  const path = findRoute(layout, train, target);
  const base: Movement = { valid: false, reason: '', distance: path ? pathLength(path) : 0, path: path ?? [], stop: target, trainId, leading: train.leading, source: scenario };
  const reject = (reason: string) => ({ ...base, reason });
  if (!path) return reject('No direct movement exists in the selected direction. Reverse the leading end or choose a connected track.');
  if (base.distance <= EPS) return reject('Choose a destination ahead of the active leading end.');
  for (const s of path) {
    const gate = layout.segments[s.segment].gate;
    if (gate && scenario.points[gate.points] !== gate.position) return reject(`Points ${gate.points} are set to the other route. Required: ${gate.position}.`);
    for (const buffer of layout.buffers.filter(b => b.segment === s.segment)) {
      const allowed = buffer.end === 'a' ? layout.margins.buffer : length(layout.segments[s.segment]) - layout.margins.buffer;
      if ((buffer.end === 'a' && min(s) < allowed - EPS) || (buffer.end === 'b' && max(s) > allowed + EPS)) return reject(`The whole train cannot fit before the stopping limit on ${s.segment}. Buffer allowance: ${layout.margins.buffer} m.`);
    }
  }
  const limit = obstructionLimit(layout, scenario, train, path, { distance: base.distance, reason: '' });
  if (limit.distance < base.distance - EPS) return reject(limit.reason);
  const result = scenarioAtMovement(base, base.distance);
  const moved = result.trains.find(t => t.id === trainId)!;
  if (Math.abs(pathLength(moved.path) - trainLength(train)) > EPS) return reject('The whole train cannot fit before the stopping limit.');
  for (const other of scenario.trains.filter(t => t.id !== trainId)) {
    if (moved.path.some(s => other.path.some(o => overlaps(s, o, layout.margins.train)))) return reject(`Train ${other.id} occupies the required interval.`);
  }
  return { ...base, valid: true, reason: `Route clear · ${base.distance.toFixed(1)} m · full ${trainLength(train)} m footprint checked.`, result };
}
// Try both cabs without mutating the scenario. Preserve the blocker on the
// actual route instead of hiding it behind a failed search in the other direction.
export function planMove(layout: Layout, scenario: Scenario, trainId: string, target: Destination): Movement {
  const forward = validateMove(layout, scenario, trainId, target);
  if (forward.path.length) return forward;
  const backward = validateMove(layout, reverseTrain(scenario, trainId), trainId, target);
  if (backward.path.length) return { ...backward, source: scenario };
  return { ...forward, reason: 'No direct route to this destination from either end. A shunt may need an intermediate stop.' };
}
export function planDrag(layout: Layout, scenario: Scenario, trainId: string, grab: Vec, pointer: Vec): Movement {
  const candidates = [scenario, reverseTrain(scenario, trainId)].map(oriented =>
    validateMove(layout, oriented, trainId, dragTarget(layout, oriented, trainId, grab, pointer)));
  const command = candidates[1].distance > candidates[0].distance ? candidates[1] : candidates[0];
  return { ...command, source: scenario };
}
// Revalidate at commit time. A stale preview cannot overwrite another action.
export function commitMove(layout: Layout, scenario: Scenario, movement: Movement): { scenario: Scenario; error?: string } {
  if (movement.source !== scenario) return { scenario, error: 'The scenario changed. Preview the movement again.' };
  const checked = validateMove(layout, withMovementDirection(scenario, movement.trainId, movement.leading), movement.trainId, movement.stop);
  return checked.valid ? { scenario: checked.result! } : { scenario, error: checked.reason };
}

export function clearanceNumbers(train: number, margin: number, availableBeyond: number, headBeyond = 0) {
  const requiredBeyond = train + margin;
  return { requiredBeyond, additional: Math.max(0, requiredBeyond - headBeyond), remaining: availableBeyond - requiredBeyond, shortfall: Math.max(0, requiredBeyond - availableBeyond) };
}
export interface Clearance {
  valid: boolean; reason: string; trainLength: number; additional: number;
  remaining: number; shortfall: number; available: number; boundary?: Destination;
  stop?: Destination; movement?: Movement; headBeyond?: number;
}
export function clearancePlan(layout: Layout, scenario: Scenario, trainId: string, pointsId: string): Clearance {
  const train = scenario.trains.find(t => t.id === trainId)!, total = trainLength(train);
  const forward = forwardRoute(layout, scenario, train);
  const combined = cutPath([...travelPath(train), ...forward.path], 0, total + pathLength(forward.path));
  const zone = layout.points[pointsId].zone;
  let offset = 0, lastExit: number | undefined;
  let boundary: Destination | undefined;
  for (const s of combined) {
    const sign = Math.sign(s.to - s.from);
    for (const z of zone) {
      if (s.segment !== z.segment) continue;
      const lo = Math.max(min(s), min(z)), hi = Math.min(max(s), max(z));
      const justBehind = overlaps(s, z, layout.margins.points) && (sign > 0 ? max(z) <= s.from : min(z) >= s.from);
      if (hi < lo - EPS && !justBehind) continue;
      const exit = justBehind ? (sign > 0 ? max(z) : min(z)) : (sign > 0 ? hi : lo), d = offset + sign * (exit - s.from);
      if (lastExit === undefined || d >= lastExit) { lastExit = d; boundary = { segment: s.segment, at: exit }; }
    }
    offset += spanLength(s);
  }
  const available = obstructionLimit(layout, scenario, train, forward.path, forward);
  const empty = { trainLength: total, additional: 0, remaining: available.distance, shortfall: 0, available: available.distance };
  if (lastExit === undefined) {
    const locked = pointsOccupants(layout, scenario, pointsId).includes(trainId);
    return { ...empty, valid: !locked, reason: locked ? `The ${pointsId} margin is still occupied; select a direction through its boundary.` : `Train ${trainId} is already clear of ${pointsId}; no boundary lies ahead in this direction.` };
  }
  // Boundary coordinate is relative to the current head. For an occupied zone,
  // it may be negative: an already advanced head must not be charged twice.
  const boundaryFromHead = lastExit - total;
  const numbers = clearanceNumbers(total, layout.margins.points, available.distance - boundaryFromHead, -boundaryFromHead);
  const additional = numbers.additional;
  const stop = additional <= pathLength(forward.path) + EPS && forward.path.length ? pathPosition(forward.path, additional) : undefined;
  const movement = stop && additional > EPS ? validateMove(layout, scenario, trainId, stop) : undefined;
  const valid = numbers.shortfall < EPS && (additional < EPS || !!movement?.valid);
  const reason = numbers.shortfall > EPS
    ? `The whole train cannot clear ${pointsId}: ${numbers.shortfall.toFixed(1)} m shortfall. ${available.reason}`
    : movement && !movement.valid ? movement.reason : `${pointsId} can be cleared with ${numbers.remaining.toFixed(1)} m remaining before the allowed limit.`;
  return { valid, reason, trainLength: total, additional, remaining: numbers.remaining, shortfall: numbers.shortfall, available: available.distance, boundary, stop, movement, headBeyond: -boundaryFromHead };
}

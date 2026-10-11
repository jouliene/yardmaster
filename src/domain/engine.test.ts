import { describe, expect, it } from 'vitest';
import { makeScenario, yard } from '../data/yard';
import { fit, toScreen, toWorld, zoom } from '../canvas/camera';
import { availableMovement, changePoints, clearanceNumbers, clearancePlan, commitMove, dragTarget, lead, pointsOccupants, reverseTrain, scenarioAtMovement, trainLength, validateMove } from './engine';
import { length, pathLength, pointAt } from './geometry';
import { historyReducer, newHistory } from './history';
import type { Layout, Scenario } from './types';

function single(segment: string, from: number, to: number, leading: 'A' | 'B' = 'A'): Scenario {
  return { id: 'test', points: { P01: 'normal', P02: 'normal' }, trains: [{ id: 'T01', sections: [{ id: 'a', length: Math.abs(to - from) }], path: [{ segment, from, to }], leading }] };
}
function move(s: Scenario, segment: string, at: number) {
  const command = validateMove(yard, s, 'T01', { segment, at });
  expect(command.valid, command.reason).toBe(true);
  return command.result!;
}
describe('metric geometry and explicit connectivity', () => {
  it('derives curve length from the rendered centreline', () => {
    expect(length(yard.segments.P01R)).toBeGreaterThan(Math.hypot(40, 36));
    expect(pointAt(yard.segments.P01R, length(yard.segments.P01R))).toEqual({ x: 40, y: 36 });
  });
  it.each(['normal', 'reverse'] as const)('routes P01 %s in both directions and rejects the other branch', position => {
    const s = single('H', 70, 100); s.points.P01 = position;
    const road = position === 'normal' ? 'R1' : 'L';
    const other = position === 'normal' ? 'L' : 'R1';
    const forward = validateMove(yard, s, 'T01', { segment: road, at: 20 });
    expect(forward.valid, forward.reason).toBe(true);
    expect(validateMove(yard, s, 'T01', { segment: other, at: 20 }).reason).toContain('P01 are set to the other route');
    expect(validateMove(yard, reverseTrain(forward.result!, 'T01'), 'T01', { segment: 'H', at: 100 }).valid).toBe(true);
    const incoming = single(road, 25, 15); incoming.points.P01 = position === 'normal' ? 'reverse' : 'normal';
    expect(validateMove(yard, incoming, 'T01', { segment: 'H', at: 150 }).reason).toContain('P01 are set to the other route');
  });
  it.each(['normal', 'reverse'] as const)('routes P02 %s in both directions', position => {
    const s = single('L', 10, 20); s.points.P02 = position;
    const road = position === 'normal' ? 'R2' : 'R3';
    const arrived = move(s, road, 30);
    expect(validateMove(yard, reverseTrain(arrived, 'T01'), 'T01', { segment: 'L', at: 10 }).valid).toBe(true);
    const wrong = { ...s, points: { ...s.points, P02: position === 'normal' ? 'reverse' as const : 'normal' as const } };
    expect(validateMove(yard, wrong, 'T01', { segment: road, at: 30 }).reason).toContain('P02');
    const incoming = reverseTrain(arrived, 'T01'); incoming.points.P02 = wrong.points.P02;
    expect(validateMove(yard, incoming, 'T01', { segment: 'L', at: 10 }).reason).toContain('P02 are set to the other route');
  });
  it('rejects branch-to-branch shortcuts', () => {
    expect(validateMove(yard, single('R1', 60, 30), 'T01', { segment: 'L', at: 20 }).valid).toBe(false);
    expect(validateMove(yard, single('R2', 60, 30), 'T01', { segment: 'R3', at: 30 }).valid).toBe(false);
  });
  it('does not connect visual crossings or nearby endpoints', () => {
    const layout: Layout = { ...yard, segments: { ...yard.segments, X: { id: 'X', label: 'X', geometry: [{ x: 100, y: -30 }, { x: 100, y: 30 }] } } };
    expect(validateMove(layout, single('R1', 20, 50), 'T01', { segment: 'X', at: 30 }).valid).toBe(false);
  });
});
describe('full footprint, clearance and reversal', () => {
  it('starts every preset with the correct length and no overlapping trains', () => {
    for (const id of ['shunt', 'short', 'blocked']) {
      const s = makeScenario(id);
      for (const t of s.trains) expect(pathLength(t.path)).toBe(trainLength(t));
      expect(pointsOccupants(yard, s, 'P01')).toEqual([]);
      expect(pointsOccupants(yard, s, 'P02')).toEqual([]);
    }
  });
  it('keeps exact occupied intervals across three segments', () => {
    const s = move(makeScenario(), 'H', 165);
    expect(s.trains[0].path).toEqual([{ segment: 'R1', from: 20, to: 0 }, { segment: 'P01N', from: 40, to: 0 }, { segment: 'H', from: 180, to: 165 }]);
    expect(pathLength(s.trains[0].path)).toBe(75);
  });
  it('locks until the entire tail AND 5 m margin clear', () => {
    const s = makeScenario();
    const almost = move(s, 'H', 91);
    expect(changePoints(yard, almost, 'P01').error).toContain('T01');
    expect(clearancePlan(yard, almost, 'T01', 'P01').additional).toBeCloseTo(1);
    const clear = move(almost, 'H', 90);
    expect(pointsOccupants(yard, clear, 'P01')).toEqual([]);
    expect(changePoints(yard, clear, 'P01').error).toBeUndefined();
  });
  it('adjoining fouling occupancy prevents a conflicting movement', () => {
    const s = single('H', 90, 120);
    s.trains.push({ id: 'T02', sections: [{ id: 'x', length: 6 }], path: [{ segment: 'L', from: 4, to: 10 }], leading: 'A' });
    expect(validateMove(yard, s, 'T01', { segment: 'R1', at: 50 }).reason).toContain('fouling/clearance zone of points P01');
    expect(changePoints(yard, s, 'P01').error).toContain('T02');
  });
  it('reversal only swaps the active end and preserves section identities', () => {
    const s = move(makeScenario(), 'H', 165), reversed = reverseTrain(s, 'T01');
    expect(reversed.trains[0].path).toBe(s.trains[0].path);
    expect(reversed.trains[0].sections).toBe(s.trains[0].sections);
    expect(lead(reversed.trains[0])).toEqual({ segment: 'R1', at: 20 });
    expect(reverseTrain(reversed, 'T01')).toEqual(s);
  });
  it('completes a clear / switch / reverse / enter R2 shunt', () => {
    let s = makeScenario();
    const clear = clearancePlan(yard, s, 'T01', 'P01');
    expect(clear.additional).toBeCloseTo(150);
    expect(clear.valid).toBe(true);
    s = clear.movement!.result!;
    s = changePoints(yard, s, 'P01').scenario;
    s = reverseTrain(s, 'T01');
    s = move(s, 'R2', 110);
    expect(s.trains[0].path).toEqual([{ segment: 'R2', from: 110, to: 35 }]);
    expect(s.trains[0].sections.map(x => x.id)).toEqual(['T01-1', 'T01-2', 'T01-3']);
  });
});
describe('swept movement and stopping limits', () => {
  it('constrains dragging to the selected route, never a nearby parallel road', () => {
    const s = single('H', 100, 130);
    const target = dragTarget(yard, s, 'T01', { x: -50, y: 0 }, { x: 220, y: 36 });
    expect(target.segment).toBe('R1');
    expect(validateMove(yard, s, 'T01', target).valid).toBe(true);
  });
  it('rejects a large drag past an obstacle without moving the source', () => {
    const s = makeScenario('blocked'), before = JSON.stringify(s);
    const target = dragTarget(yard, s, 'T01', { x: 60, y: 0 }, { x: -170, y: 0 });
    expect(validateMove(yard, s, 'T01', target).reason).toContain('T02');
    expect(JSON.stringify(s)).toBe(before);
  });
  it('prevents overlap and tunnelling even beyond the obstruction', () => {
    const s = makeScenario('blocked');
    const command = validateMove(yard, s, 'T01', { segment: 'H', at: 10 });
    expect(command.valid).toBe(false);
    expect(command.reason).toContain('T02');
    expect(availableMovement(yard, s, s.trains[0]).distance).toBe(110);
  });
  it('allows two trains on the same road at exactly the configured clearance', () => {
    const s = single('R1', 20, 50);
    s.trains.push({ id: 'T02', sections: [{ id: 'x', length: 20 }], path: [{ segment: 'R1', from: 150, to: 170 }], leading: 'A' });
    expect(validateMove(yard, s, 'T01', { segment: 'R1', at: 147 }).valid).toBe(true);
    expect(validateMove(yard, s, 'T01', { segment: 'R1', at: 147.01 }).valid).toBe(false);
  });
  it('includes the buffer allowance exactly once', () => {
    const s = single('H', 120, 90);
    expect(validateMove(yard, s, 'T01', { segment: 'H', at: 5 }).valid).toBe(true);
    expect(validateMove(yard, s, 'T01', { segment: 'H', at: 4.9 }).reason).toContain('stopping limit');
    expect(availableMovement(yard, s, s.trains[0]).distance).toBe(85);
  });
  it('rejects commands and stale previews without mutation', () => {
    const s = makeScenario('blocked'), before = JSON.stringify(s);
    const command = validateMove(yard, s, 'T01', { segment: 'H', at: 10 });
    expect(commitMove(yard, s, command).scenario).toBe(s);
    expect(JSON.stringify(s)).toBe(before);
    const fresh = makeScenario(), valid = validateMove(yard, fresh, 'T01', { segment: 'H', at: 90 });
    expect(commitMove(yard, reverseTrain(fresh, 'T01'), valid).error).toContain('changed');
  });
  it('uses physical distance for intermediate animation frames', () => {
    const command = validateMove(yard, makeScenario(), 'T01', { segment: 'H', at: 90 });
    for (const d of [0, 0.1, 27, 65, 99.9, 150]) {
      const train = scenarioAtMovement(command, d).trains[0];
      expect(pathLength(train.path)).toBeCloseTo(75);
    }
    expect(scenarioAtMovement(command, 1e6)).toEqual(command.result);
  });
});
describe('minimum move to clear', () => {
  it('matches all 75 m / 5 m acceptance values', () => {
    expect(clearanceNumbers(75, 5, 70)).toMatchObject({ requiredBeyond: 80, shortfall: 10, remaining: -10 });
    expect(clearanceNumbers(75, 5, 90)).toMatchObject({ requiredBeyond: 80, shortfall: 0, remaining: 10 });
    expect(clearanceNumbers(75, 5, 90, 30).additional).toBe(50);
  });
  it('derives the 10 m shortfall from real geometry and another train', () => {
    const clear = clearancePlan(yard, makeScenario('short'), 'T01', 'P01');
    expect(clear.additional).toBe(150);
    expect(clear.shortfall).toBe(10);
    expect(clear.valid).toBe(false);
    expect(clear.reason).toContain('T02');
  });
  it('only needs 50 m once the head is already 30 m past the boundary', () => {
    const s = move(makeScenario(), 'H', 140);
    const clear = clearancePlan(yard, s, 'T01', 'P01');
    expect(clear.headBeyond).toBe(30);
    expect(clear.additional).toBe(50);
  });
  it('supports variable sections, not hardcoded 75 m trains', () => {
    const s = single('R1', 70, 20);
    expect(clearancePlan(yard, s, 'T01', 'P01').additional).toBe(125);
  });
  it('measures curves and points routes in the clearance calculation', () => {
    const s = single('R2', 85, 10); s.points.P01 = 'reverse';
    const plan = clearancePlan(yard, s, 'T01', 'P01');
    expect(plan.additional).toBeCloseTo(10 + 40 + 30 + length(yard.segments.P01R) + 10 + 80);
  });
  it('does not invent space beyond a buffer', () => {
    const layout: Layout = { ...yard, margins: { ...yard.margins, buffer: 100 } };
    const clear = clearancePlan(layout, makeScenario(), 'T01', 'P01');
    expect(clear.valid).toBe(false);
    expect(clear.shortfall).toBe(10);
  });
});
describe('history and camera isolation', () => {
  it('undo/redo restores trains and points; a new action clears the redo branch; reset clears history', () => {
    const start = makeScenario(), moved = move(start, 'H', 90), switched = changePoints(yard, moved, 'P01').scenario;
    let h = newHistory(start);
    h = historyReducer(h, { type: 'commit', scenario: moved });
    h = historyReducer(h, { type: 'commit', scenario: switched });
    h = historyReducer(h, { type: 'undo' }); expect(h.present).toEqual(moved);
    h = historyReducer(h, { type: 'redo' }); expect(h.present).toEqual(switched);
    h = historyReducer(h, { type: 'undo' });
    h = historyReducer(h, { type: 'commit', scenario: reverseTrain(h.present, 'T01') }); expect(h.future).toEqual([]);
    h = historyReducer(h, { type: 'reset', scenario: start }); expect(h).toEqual(newHistory(start));
  });
  it('zoom, pan, fit and resize cannot change physical results', () => {
    const s = makeScenario(), before = clearancePlan(yard, s, 'T01', 'P01');
    for (const width of [900, 1440, 2000]) {
      const c = zoom(fit([{ x: -180, y: 0 }, { x: 330, y: 72 }], width, 700), { x: 300, y: 300 }, 2);
      const p = { x: 18.7, y: 35 };
      expect(toWorld(toScreen(p, c), c).x).toBeCloseTo(p.x);
    }
    expect(clearancePlan(yard, s, 'T01', 'P01')).toEqual(before);
  });
});

import { describe, expect, it } from 'vitest';
import { availableMovement, changePoints, clearancePlan, commitMove, planDrag, planMove, pointsOccupants, reverseTrain, scenarioAtMovement, validateMove } from './engine';
import { pathLength } from './geometry';
import { pathsConflict } from './metric';

import { road } from './road.fixture';

describe('physical clearance independent of ordinary joins', () => {
  it.each([{ cuts: [0, 200] }, { cuts: [0, 100, 200] }])('rejects the 2 m gap on road $cuts', ({ cuts }) => {
    const r = road(cuts), s = r.scenario();
    expect.soft(validateMove(r.layout, s, 'moving', r.destination(99)).valid).toBe(false);
    expect.soft(availableMovement(r.layout, s, s.trains[0]).distance).toBe(8);
    expect(validateMove(r.layout, s, 'moving', r.destination(98)).valid).toBe(true);
  });
});

describe('joined metric route cases', () => {
  const representations = [
    { cuts: [0, 200], reversed: false },
    { cuts: [0, 100, 200], reversed: false },
    { cuts: [0, 100, 200], reversed: true },
    { cuts: [0, 100, 200], reversed: [1] },
    { cuts: [0, 97, 98, 99, 100, 101, 200], reversed: [0, 2, 5] },
    { cuts: [0, 97, 98, 99, 100, 100.5, 101, 200], reversed: false },
    { cuts: [0, 85, 95, 100, 105, 200], reversed: true },
  ];
  it.each(representations)('agrees in both directions with $cuts / reversed=$reversed', ({ cuts, reversed }) => {
    const r = road(cuts, reversed);
    for (const backwards of [false, true]) {
      const s = backwards ? r.scenario(111, 101, 80, 90) : r.scenario();
      const good = r.destination(backwards ? 93 : 98), bad = r.destination(backwards ? 92 : 99);
      expect(availableMovement(r.layout, s, s.trains[0]).distance).toBeCloseTo(8);
      expect(validateMove(r.layout, s, 'moving', bad).valid).toBe(false);
      const command = planMove(r.layout, s, 'moving', good);
      expect(command.valid, command.reason).toBe(true);
      expect(commitMove(r.layout, s, command).scenario).toEqual(command.result);
      for (const at of [0, 2.1, 7.9, 8]) {
        const frame = scenarioAtMovement(command, at);
        expect(pathLength(frame.trains[0].path)).toBeCloseTo(10);
        expect(pathsConflict(r.layout, frame.trains[0].path, frame.trains[1].path, 3)).toBe(false);
      }
      const before = structuredClone(s);
      const rejected = planMove(r.layout, s, 'moving', r.destination(backwards ? 10 : 180));
      expect(rejected.valid).toBe(false);
      expect(commitMove(r.layout, s, rejected).scenario).toBe(s);
      expect(s).toEqual(before);
      expect(reverseTrain(reverseTrain(s, 'moving'), 'moving')).toEqual(s);
      const grab = { x: backwards ? 106 : 85, y: 0 };
      expect(planDrag(r.layout, s, 'moving', grab, { x: backwards ? 97 : 94, y: 0 }).valid).toBe(false);
    }
  });
  it.each([false, true])('uses polyline arc length, with reversed geometry=%s', reversed => {
    for (const cuts of [[0, 200], [0, 100, 200], [0, 97, 99, 100, 101, 200]]) {
      const r = road(cuts, reversed);
      const point = (at: number) => at <= 100 ? { x: at * .6, y: at * .8 } : { x: at * .6, y: (200 - at) * .8 };
      for (const [i, segment] of Object.values(r.layout.segments).entries()) {
        const vertices = [cuts[i], ...(cuts[i] < 100 && cuts[i + 1] > 100 ? [100] : []), cuts[i + 1]].map(point);
        segment.geometry = reversed ? vertices.reverse() : vertices;
      }
      const s = r.scenario();
      expect(availableMovement(r.layout, s, s.trains[0]).distance).toBeCloseTo(8);
      expect(validateMove(r.layout, s, 'moving', r.destination(99)).valid).toBe(false);
      expect(validateMove(r.layout, s, 'moving', r.destination(98)).valid).toBe(true);
    }
  });
  it('does not extend margins onto an unlinked coincident track', () => {
    const r = road([0, 100, 200]); r.layout.links = [];
    const s = r.scenario();
    expect(availableMovement(r.layout, s, s.trains[0]).distance).toBe(10);
    expect(validateMove(r.layout, s, 'moving', r.destination(99)).valid).toBe(true);
    expect(validateMove(r.layout, s, 'moving', r.destination(180)).valid).toBe(false);
  });
  it.each([false, true])('carries buffer allowance backwards over short joins, reversed=%s', reversed => {
    for (const cuts of [[0, 200], [0, 196, 197, 199, 200]]) {
      const r = road(cuts, reversed), s = r.scenario(180, 190); s.trains.pop();
      r.layout.buffers = [{ segment: `S${cuts.length - 2}`, end: reversed ? 'a' : 'b' }];
      expect(availableMovement(r.layout, s, s.trains[0]).distance).toBe(5);
      expect(validateMove(r.layout, s, 'moving', r.destination(195)).valid).toBe(true);
      expect(validateMove(r.layout, s, 'moving', r.destination(195.1)).valid).toBe(false);
    }
  });
  it.each([false, true])('locks points and clears the tail across a join, backwards=%s', backwards => {
    for (const cuts of [[0, 200], [0, 98, 100, 102, 200]]) {
      const r = road(cuts), s = backwards ? r.scenario(99, 89) : r.scenario(101, 111);
      s.trains.pop(); s.points.P = 'normal';
      r.layout.points.P = { id: 'P', at: { x: 100, y: 0 }, zone: r.path(backwards ? 101 : 90, backwards ? 110 : 99) };
      expect(pointsOccupants(r.layout, s, 'P')).toEqual(['moving']);
      expect(changePoints(r.layout, s, 'P').scenario).toBe(s);
      const clear = clearancePlan(r.layout, s, 'moving', 'P');
      expect(clear.valid, clear.reason).toBe(true);
      expect(clear.additional).toBeCloseTo(3);
      expect(pointsOccupants(r.layout, clear.movement!.result!, 'P')).toEqual([]);
    }
  });
  it('protects another train in the margin of a points zone across a join', () => {
    const r = road([0, 98, 100, 102, 200]), s = r.scenario(70, 80, 101, 111);
    r.layout.points.P = { id: 'P', at: { x: 95, y: 0 }, zone: r.path(90, 99) };
    s.points.P = 'normal';
    expect(pointsOccupants(r.layout, s, 'P')).toEqual(['parked']);
    expect(availableMovement(r.layout, s, s.trains[0]).distance).toBe(5);
    expect(validateMove(r.layout, s, 'moving', r.destination(86)).reason).toContain('fouling/clearance');
    expect(validateMove(r.layout, s, 'moving', r.destination(85)).valid).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { makeScenario, presets, yard } from '../data/yard';
import { activateScenario } from './activation';
import { clearancePlan, commitMove, planMove, pointsOccupants, reverseTrain, scenarioAtMovement } from './engine';
import { historyReducer, newHistory } from './history';
import { road } from './road.fixture';
import type { Layout, Scenario } from './types';
import { ENDPOINT_TOLERANCE, validateActivation, validateLayout, validateScenario, type Validation } from './validation';

function hasCode(result: Pick<Validation<unknown>, 'valid' | 'diagnostics'>, code: string) {
  expect(result.valid, JSON.stringify(result.diagnostics)).toBe(false);
  expect(result.diagnostics.map(d => d.code)).toContain(code);
  for (const d of result.diagnostics) {
    expect(d.message.length).toBeGreaterThan(5);
    expect(d.path.length).toBeGreaterThan(0);
  }
}

describe('layout validation boundary', () => {
  it('accepts the yard, a road without points and disconnected components', () => {
    expect(validateLayout(yard).valid).toBe(true);
    const r = road([0, 100, 200]);
    expect(validateLayout(r.layout).valid).toBe(true);
    r.layout.links = [];
    expect(validateLayout(r.layout).valid).toBe(true);
  });
  it.each([null, undefined, [], 42, {}, { segments: null, links: {}, buffers: 'no', points: [] }])('diagnoses malformed root %j without throwing', input => {
    expect(validateLayout(input).valid).toBe(false);
    expect(validateScenario(input, {}).valid).toBe(false);
  });
  const invalid: [string, (l: Layout) => void, string][] = [
    ['unknown link', l => { l.links[0].to.segment = 'missing'; }, 'port.invalid'],
    ['invalid port end', l => { (l.links[0].to as unknown as { end: string }).end = 'c'; }, 'port.invalid'],
    ['nonfinite geometry', l => { l.segments.H.geometry[0].x = NaN; }, 'geometry.invalid'],
    ['infinite geometry', l => { l.segments.H.geometry[0].y = Infinity; }, 'geometry.invalid'],
    ['zero segment', l => { l.segments.H.geometry[0] = l.segments.H.geometry[1]; }, 'geometry.length'],
    ['repeated vertex', l => { l.segments.H.geometry.push(l.segments.H.geometry[1]); }, 'geometry.edge'],
    ['overflowing geometry', l => { l.segments.H.geometry = [{ x: -1e308, y: 0 }, { x: 1e308, y: 0 }]; }, 'geometry.length'],
    ['negative margin', l => { l.margins.train = -1; }, 'margin.invalid'],
    ['NaN margin', l => { l.margins.points = NaN; }, 'margin.invalid'],
    ['infinite margin', l => { l.margins.buffer = Infinity; }, 'margin.invalid'],
    ['mismatched ID', l => { l.segments.H.id = 'wrong'; }, 'id.invalid'],
    ['empty points ID', l => { l.points.P01.id = ''; }, 'id.invalid'],
    ['missing points reference', l => { l.segments.P01N.gate!.points = 'missing'; }, 'gate.invalid'],
    ['invalid gate state', l => { (l.segments.P01N.gate as unknown as { position: string }).position = 'sideways'; }, 'gate.invalid'],
    ['link geometry', l => { l.segments.H.geometry[1].y = .01; }, 'link.geometry'],
    ['reversed duplicate link', l => { const a = l.links[0]; l.links.push({ from: a.to, to: a.from }); }, 'link.duplicate'],
    ['self link', l => { l.links.push({ from: { segment: 'R1', end: 'a' }, to: { segment: 'R1', end: 'b' } }); }, 'link.self'],
    ['unknown buffer', l => { l.buffers[0].segment = 'missing'; }, 'port.invalid'],
    ['duplicate buffer', l => { l.buffers.push(l.buffers[0]); }, 'buffer.duplicate'],
    ['buffer with through link', l => { l.buffers.push({ segment: 'H', end: 'b' }); }, 'buffer.connected'],
    ['missing reverse route', l => { delete l.segments.P01R.gate; }, 'points.routes'],
    ['invalid marker', l => { l.points.P01.at.x = Infinity; }, 'points.location'],
    ['marker away from toe', l => { l.points.P01.at.x = 1; }, 'points.location'],
    ['unknown zone segment', l => { l.points.P01.zone[0].segment = 'missing'; }, 'interval.reference'],
    ['NaN zone bound', l => { l.points.P01.zone[0].from = NaN; }, 'interval.nonfinite'],
    ['zone outside segment', l => { l.points.P01.zone[0].to = 181; }, 'interval.bounds'],
    ['empty zone', l => { l.points.P01.zone = []; }, 'zone.empty'],
    ['incomplete gate zone', l => { l.points.P01.zone.find(z => z.segment === 'P01N')!.from = 1; }, 'zone.route_coverage'],
    ['missing adjoining zone', l => { l.points.P01.zone = l.points.P01.zone.filter(z => z.segment !== 'L'); }, 'zone.adjoining_coverage'],
    ['adjoining zone detached from endpoint', l => { l.points.P01.zone.find(z => z.segment === 'R1')!.from = 1; }, 'zone.adjoining_coverage'],
    ['ambiguous ordinary branch', l => { delete l.segments.P01N.gate; delete l.segments.P01R.gate; }, 'topology.ambiguous'],
    ['ungated route termination', l => { l.links = l.links.filter(x => x.to.segment !== 'R1'); }, 'points.branch'],
    ['cyclic track', l => { l.links.push({ from: { segment: 'R1', end: 'b' }, to: { segment: 'R2', end: 'b' } }); }, 'topology.cycle'],
  ];
  it.each(invalid)('rejects %s', (_name, edit, code) => {
    const layout = structuredClone(yard); edit(layout);
    hasCode(validateLayout(layout), code);
  });
  it('uses the documented endpoint tolerance', () => {
    const l = structuredClone(yard);
    l.segments.H.geometry[1].y += ENDPOINT_TOLERANCE / 2;
    expect(validateLayout(l).valid).toBe(true);
    l.segments.H.geometry[1].y += ENDPOINT_TOLERANCE * 2;
    hasCode(validateLayout(l), 'link.geometry');
  });
  it('validates coverage of authored adjoining intervals, not invented distances', () => {
    const l = structuredClone(yard);
    l.points.P01.zone.find(z => z.segment === 'R1')!.to = .1;
    expect(validateLayout(l).valid).toBe(true);
    l.points.P01.zone = l.points.P01.zone.flatMap(z => z.segment === 'P01N' ? [{ ...z, to: 20 }, { ...z, from: 20 }] : [z]);
    expect(validateLayout(l).valid).toBe(true);
    l.points.P01.zone.find(z => z.segment === 'P01N')!.to = 19;
    hasCode(validateLayout(l), 'zone.route_coverage');
  });
  it('handles malformed nested entries and sparse arrays without incidental exceptions', () => {
    const variants: ((l: Record<string, unknown>) => void)[] = [
      l => { l.segments = { S: null }; }, l => { l.points = { P: null }; },
      l => { l.links = [null]; }, l => { l.buffers = [null]; },
      l => { (l.points as Layout['points']).P01.zone = new Array(2); },
      l => { (l.segments as Layout['segments']).H.geometry = new Array(2); },
    ];
    for (const edit of variants) { const l = structuredClone(yard) as unknown as Record<string, unknown>; edit(l); expect(validateLayout(l).valid).toBe(false); }
  });
});

describe('scenario validation boundary', () => {
  it.each(presets)('accepts existing preset $id, including valid but blocked manoeuvres', preset => {
    const s = makeScenario(preset.id), before = structuredClone(s);
    expect(validateScenario(yard, s)).toEqual({ valid: true, value: s, diagnostics: [] });
    expect(s).toEqual(before);
  });
  it('allows a single train in points, and consistent frames and reversal', () => {
    const move = planMove(yard, makeScenario(), 'T01', { segment: 'H', at: 140 });
    expect(move.valid).toBe(true);
    for (const at of [0, .1, 20, 45, 80, 100]) {
      const s = scenarioAtMovement(move, at);
      expect(validateScenario(yard, s).valid).toBe(true);
      expect(validateScenario(yard, reverseTrain(s, 'T01')).valid).toBe(true);
    }
    expect(pointsOccupants(yard, move.result!, 'P01')).toEqual(['T01']);
    expect(validateScenario(yard, move.result!).valid).toBe(true);
  });
  it.each([undefined, null, 42, [], {}, { id: 's', trains: [null], points: {} }])('handles malformed scenario %j', input => {
    expect(validateScenario(yard, input).valid).toBe(false);
  });
  const invalid: [string, (s: Scenario) => void, string][] = [
    ['duplicate train', s => { s.trains[1].id = 'T01'; }, 'train.id'],
    ['empty train ID', s => { s.trains[0].id = ''; }, 'train.id'],
    ['invalid section ID', s => { s.trains[0].sections[0].id = ' '; }, 'section.id'],
    ['duplicate section ID across trains', s => { s.trains[1].sections[0].id = s.trains[0].sections[0].id; }, 'section.id'],
    ['NaN section length', s => { s.trains[0].sections[0].length = NaN; }, 'section.length'],
    ['infinite section length', s => { s.trains[0].sections[0].length = Infinity; }, 'section.length'],
    ['negative section length', s => { s.trains[0].sections[0].length = -1; }, 'section.length'],
    ['zero section length', s => { s.trains[0].sections[0].length = 0; }, 'section.length'],
    ['length mismatch', s => { s.trains[0].sections[0].length = 24; }, 'train.length'],
    ['unknown occupied segment', s => { s.trains[0].path[0].segment = 'missing'; }, 'interval.reference'],
    ['nonfinite interval', s => { s.trains[0].path[0].to = NaN; }, 'interval.nonfinite'],
    ['infinite interval', s => { s.trains[0].path[0].from = -Infinity; }, 'interval.nonfinite'],
    ['out of bounds', s => { s.trains[0].path[0].from = 999; }, 'interval.bounds'],
    ['zero interval', s => { s.trains[0].path[0].to = 95; }, 'interval.bounds'],
    ['invalid leading end', s => { (s.trains[0] as unknown as { leading: string }).leading = 'C'; }, 'train.leading'],
    ['unknown points', s => { s.points.unknown = 'normal'; }, 'points.reference'],
    ['missing points state', s => { delete s.points.P01; }, 'points.state'],
    ['invalid points state', s => { (s.points as Record<string, string>).P01 = 'sideways'; }, 'points.state'],
    ['overlap', s => { s.trains[1].path = [{ segment: 'R1', from: 40, to: 80 }]; }, 'train.overlap'],
    ['buffer violation', s => { s.trains[1].path = [{ segment: 'R3', from: 179, to: 219 }]; }, 'train.buffer'],
    ['two trains in shared fouling zone', s => {
      s.trains[0].path = [{ segment: 'H', from: 170, to: 95 }];
      s.trains[1].path = [{ segment: 'R1', from: 10, to: 50 }];
    }, 'points.conflict'],
  ];
  it.each(invalid)('rejects %s', (_name, edit, code) => {
    const s = makeScenario(); edit(s); hasCode(validateScenario(yard, s), code);
  });
  it('keeps authored turnout protection invariant when its adjoining road is split', () => {
    const layout = structuredClone(yard), scenario = makeScenario();
    scenario.trains[0].path = [{ segment: 'R1', from: 11, to: 86 }];
    const unsplit = clearancePlan(layout, scenario, 'T01', 'P01');
    expect(validateScenario(layout, scenario).valid).toBe(true);
    layout.segments.R1.geometry = [{ x: 40, y: 0 }, { x: 50, y: 0 }];
    layout.segments.R1tail = { id: 'R1tail', label: 'Adjoining road continuation', geometry: [{ x: 50, y: 0 }, { x: 330, y: 0 }] };
    layout.links.push({ from: { segment: 'R1', end: 'b' }, to: { segment: 'R1tail', end: 'a' } });
    layout.buffers.find(p => p.segment === 'R1')!.segment = 'R1tail';
    scenario.trains[0].path = [{ segment: 'R1tail', from: 1, to: 76 }];
    expect(validateScenario(layout, scenario).valid).toBe(true);
    expect(pointsOccupants(layout, scenario, 'P01')).toEqual(['T01']);
    const split = clearancePlan(layout, scenario, 'T01', 'P01');
    expect(split.additional).toBe(2);
    expect(split.additional).toBe(unsplit.additional);
    expect(split.remaining).toBe(unsplit.remaining);
    expect(split.valid).toBe(true);
    expect(validateScenario(layout, split.movement!.result!).valid).toBe(true);
    expect(pointsOccupants(layout, split.movement!.result!, 'P01')).toEqual([]);
  });
  it('rejects occupied gates inconsistent with points states', () => {
    const command = planMove(yard, makeScenario(), 'T01', { segment: 'H', at: 165 });
    const s = command.result!; s.points.P01 = 'reverse';
    hasCode(validateScenario(yard, s), 'train.gate');
  });
  it.each([false, true])('checks separation across joins and exact equality, reversed=%s', reversed => {
    for (const cuts of [[0, 200], [0, 98, 99, 100, 200]]) {
      const r = road(cuts, reversed);
      expect(validateScenario(r.layout, r.scenario(88, 98)).valid).toBe(true);
      hasCode(validateScenario(r.layout, r.scenario(89, 99)), 'train.separation');
      expect(validateScenario(r.layout, r.scenario(93, 103, 80, 90)).valid).toBe(true);
      hasCode(validateScenario(r.layout, r.scenario(92, 102, 80, 90)), 'train.separation');
    }
  });
  it('validates directed continuity and permits consecutive slices in one direction', () => {
    const r = road([0, 100, 200]), s = r.scenario(95, 105, 150, 160);
    expect(validateScenario(r.layout, s).valid).toBe(true);
    s.trains[0].path[1] = { segment: 'S1', from: 5, to: 0 };
    hasCode(validateScenario(r.layout, s), 'train.continuity');
    s.trains[0].path = [{ segment: 'S0', from: 90, to: 95 }, { segment: 'S0', from: 95, to: 100 }];
    expect(validateScenario(r.layout, s).valid).toBe(true);
    s.trains[0].path[1] = { segment: 'S0', from: 95, to: 90 };
    hasCode(validateScenario(r.layout, s), 'train.continuity');
    s.trains[0].path = r.path(95, 105); r.layout.links = [];
    hasCode(validateScenario(r.layout, s), 'train.continuity');
  });
  it('uses metric buffer protection across several short segments', () => {
    const r = road([0, 195, 198, 199, 200]);
    r.layout.buffers = [{ segment: 'S3', end: 'b' }];
    expect(validateScenario(r.layout, r.scenario(185, 195, 20, 30)).valid).toBe(true);
    hasCode(validateScenario(r.layout, r.scenario(185.1, 195.1, 20, 30)), 'train.buffer');
  });
  it('handles malformed and sparse train contents', () => {
    for (const field of ['sections', 'path'] as const) for (const bad of [null, {}, [], [null], new Array(2)]) {
      const s = makeScenario(); (s.trains[0] as unknown as Record<string, unknown>)[field] = bad;
      expect(validateScenario(yard, s).valid).toBe(false);
    }
  });
});

describe('atomic activation', () => {
  it('does not create initial history for invalid layout or scenario', () => {
    expect(activateScenario(null, makeScenario())).toMatchObject({ valid: false, history: undefined });
    expect(activateScenario(yard, null)).toMatchObject({ valid: false, history: undefined });
  });
  it('keeps the exact present, past and future on rejected activation', () => {
    const s = makeScenario(), command = planMove(yard, s, 'T01', { segment: 'H', at: 140 });
    let h = historyReducer(newHistory(s), { type: 'commit', scenario: commitMove(yard, s, command).scenario });
    h = historyReducer(h, { type: 'commit', scenario: reverseTrain(h.present, 'T01') });
    h = historyReducer(h, { type: 'undo' });
    const before = structuredClone(h), bad = makeScenario('blocked'); bad.trains[1].path[0].from = NaN;
    const rejected = activateScenario(yard, bad, h);
    expect(rejected.valid).toBe(false); expect(rejected.history).toBe(h);
    expect(rejected.history?.past).toBe(h.past); expect(rejected.history?.future).toBe(h.future);
    expect(h).toEqual(before);
    const invalidLayout = structuredClone(yard); invalidLayout.margins.points = -5;
    expect(activateScenario(invalidLayout, makeScenario(), h).history).toBe(h);
    const accepted = activateScenario(yard, makeScenario('short'), h);
    expect(accepted.valid).toBe(true);
    expect(accepted.history).toEqual(newHistory(makeScenario('short')));
    expect(h).toEqual(before);
  });
  it('keeps domain validation independent of the desktop selection requirements', () => {
    const s = makeScenario(); s.trains = [];
    expect(validateScenario(yard, s).valid).toBe(true);
    hasCode(activateScenario(yard, s), 'activation.no_trains');
    const r = road();
    expect(validateScenario(r.layout, r.scenario()).valid).toBe(true);
    hasCode(activateScenario(r.layout, r.scenario()), 'activation.no_points');
  });
  it('returns readable stable structured diagnostics from the joint boundary', () => {
    const bad = makeScenario(); bad.trains[0].sections[0].length = Infinity;
    expect(validateActivation(yard, bad).diagnostics).toContainEqual({ code: 'section.length', path: 'scenario.trains[0].sections[0].length', entityId: 'T01', message: 'Section length must be finite and positive.' });
  });
});

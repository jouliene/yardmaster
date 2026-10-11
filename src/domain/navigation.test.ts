import { describe, expect, it } from 'vitest';
import { makeScenario, yard } from '../data/yard';
import { commitMove, planDrag, planMove, scenarioAtMovement } from './engine';
import { historyReducer, newHistory } from './history';

describe('automatic direction for trains with two cabs', () => {
  it('previews either direction without changing placement or section identities', () => {
    const source = makeScenario(), before = JSON.stringify(source);
    const left = planMove(yard, source, 'T01', { segment: 'H', at: 90 });
    const right = planMove(yard, source, 'T01', { segment: 'R1', at: 135 });
    expect(left.valid).toBe(true); expect(left.leading).toBe('A');
    expect(right.valid).toBe(true); expect(right.leading).toBe('B');
    expect(right.distance).toBe(40); expect(right.source).toBe(source);
    expect(scenarioAtMovement(right, 0).trains[0].path).toEqual(source.trains[0].path);
    expect(right.result!.trains[0].sections).toBe(source.trains[0].sections);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('commits direction and movement together and undoes both as one action', () => {
    const source = makeScenario(), preview = planMove(yard, source, 'T01', { segment: 'R1', at: 135 });
    const committed = commitMove(yard, source, preview);
    expect(committed.error).toBeUndefined();
    expect(committed.scenario).toEqual(scenarioAtMovement(preview, preview.distance));
    expect(committed.scenario.trains[0].path).toEqual([{ segment: 'R1', from: 135, to: 60 }]);
    const history = historyReducer(newHistory(source), { type: 'commit', scenario: committed.scenario });
    expect(history.past).toHaveLength(1);
    expect(historyReducer(history, { type: 'undo' }).present).toBe(source);
  });
  it('retains collision and points blockers when using the other cab', () => {
    const source = makeScenario();
    source.trains[1].path = [{ segment: 'R1', from: 170, to: 210 }];
    const blocked = planMove(yard, source, 'T01', { segment: 'R1', at: 240 });
    expect(blocked.leading).toBe('B'); expect(blocked.reason).toContain('T02');
    expect(commitMove(yard, source, blocked).scenario).toBe(source);
    source.points.P01 = 'reverse';
    expect(planMove(yard, source, 'T01', { segment: 'H', at: 90 }).reason).toContain('P01 are set to the other route');
  });
  it('infers both drag directions and can return to the original grab without a move', () => {
    const source = makeScenario(), grab = { x: 100, y: 0 };
    const right = planDrag(yard, source, 'T01', grab, { x: 140, y: 0 });
    const left = planDrag(yard, source, 'T01', grab, { x: 60, y: 0 });
    expect(right.leading).toBe('B'); expect(right.distance).toBe(40); expect(right.valid).toBe(true);
    expect(left.leading).toBe('A'); expect(left.distance).toBe(40); expect(left.valid).toBe(true);
    expect(planDrag(yard, source, 'T01', grab, grab).valid).toBe(false);
    expect(source.trains[0].leading).toBe('A');
  });
  it('does not turn a branch-to-branch shortcut into an automatic shunt', () => {
    const source = makeScenario();
    expect(planMove(yard, source, 'T01', { segment: 'R2', at: 100 }).valid).toBe(false);
  });
  it('rejects an automatically oriented stale preview', () => {
    const source = makeScenario(), preview = planMove(yard, source, 'T01', { segment: 'R1', at: 135 });
    const changed = { ...source, points: { ...source.points, P01: 'reverse' as const } };
    expect(commitMove(yard, changed, preview).scenario).toBe(changed);
    expect(commitMove(yard, changed, preview).error).toContain('changed');
  });
});

import type { Scenario } from './types';
export interface History { past: Scenario[]; present: Scenario; future: Scenario[] }
export type HistoryAction = { type: 'commit'; scenario: Scenario } | { type: 'undo' } | { type: 'redo' } | { type: 'reset'; scenario: Scenario };
export const newHistory = (scenario: Scenario): History => ({ past: [], present: scenario, future: [] });
export function historyReducer(state: History, action: HistoryAction): History {
  if (action.type === 'reset') return newHistory(action.scenario);
  if (action.type === 'commit') return action.scenario === state.present ? state : { past: [...state.past, state.present], present: action.scenario, future: [] };
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state;
  }
  const next = state.future[0];
  return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state;
}

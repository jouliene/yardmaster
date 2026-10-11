import { newHistory, type History } from './history';
import { validateActivation, type Diagnostic } from './validation';

export type Activation = { valid: true; history: History; diagnostics: [] }
  | { valid: false; history: History | undefined; diagnostics: Diagnostic[] };

// Validate the complete candidate before allocating replacement history. A
// rejected preset/reset keeps the exact active state and both history stacks.
export function activateScenario(layout: unknown, candidate: unknown, current?: History): Activation {
  const checked = validateActivation(layout, candidate);
  if (!checked.valid) return { valid: false, history: current, diagnostics: checked.diagnostics };
  // The current desktop planner requires a selectable train and points. The
  // independent validators still support empty yards and roads without points.
  const diagnostics: Diagnostic[] = [];
  if (!checked.value.scenario.trains.length) diagnostics.push({ code: 'activation.no_trains', path: 'scenario.trains', message: 'The desktop planner requires at least one selectable train.' });
  if (!Object.keys(checked.value.layout.points).length) diagnostics.push({ code: 'activation.no_points', path: 'layout.points', message: 'The desktop planner requires at least one points object.' });
  return diagnostics.length ? { valid: false, history: current, diagnostics }
    : { valid: true, history: newHistory(checked.value.scenario), diagnostics: [] };
}

# YardMaster project status

## Navigation update — step 3 (current)

The Select / move and Pan modes are removed. Left-drag on background or a track pans; a short track click previews a destination. Left-drag on a train previews movement in either direction. Points open their map controls. The cursor changes with the target and closes during a drag. Middle-button panning still works anywhere.

Pointer events distinguish clicks from drags with a 4 CSS pixel threshold, suppressing accidental commands after a pan. Zoom and focus do not alter an active drag. Background panning does not enter scenario history. Safety checks, preview-before-execute and one-action Undo are preserved.

Final validation: **34 domain tests and 11 Brave UI workflows passed**, along with strict type checking and production build. Actual UI checks cover translated geometry selection after panning, cursor states, track-drag click suppression, middle-button panning over trains, automatic cab choice, map points locks and the complete reversing shunt. Screenshots were inspected at 1440 × 900. The existing bundle-size advisory remains non-blocking.

Each navigation step is a separate local commit. Baseline: `7199fce`; automatic direction: `8916243`; map points controls: `e07187f`; unified mouse control: the latest navigation commit. Use `git log --oneline -4` to inspect these checkpoints; use `git revert` newest first to undo changes while preserving history. No remote was configured and nothing was pushed.

## Navigation update — step 2

Train bodies and points symbols/labels are selectable directly on the map. Points selection opens a nearby control with the current position, a switching button and the occupying train IDs when locked. Map switching uses the same domain operation and one-action history as the side panel. The hit area around points is enlarged for easier selection; physical geometry is unchanged.

Validation: 34 domain tests, 8 Brave UI workflows, strict type checking and production build passed. The map popup screenshot was inspected. Automatic direction is preserved in separate commit `8916243`; this map-control change is another independent commit.

## Navigation update — step 1

The original v1 is saved in local baseline commit `7199fce`. Manual leading-end selection has been removed: click and drag infer the working cab automatically. Preview and cancellation leave the scenario unchanged; cab changes are committed and undone together with the movement. The same points, fouling, buffer and swept-collision checks still apply. Clearance feedback follows the preview's direction (or the last movement when no preview is active).

Validation: 34 domain tests, 6 Brave UI workflows, strict type checking and production build passed. This step is committed separately from map controls and unified panning. The original delivery record below describes the baseline.

Verified on 2026-10-11. Project directory: `/home/neo/jouliene/yardmaster`.

All four requested version 1 milestones are implemented. The original `Yard_Planner_Codex_Prompt.md` is retained unchanged. The directory was initially not a Git repository and contained only that prompt; no unrelated project was changed. No deployment or hosted service was created.

## Implemented milestones

| Milestone | Result |
| --- | --- |
| A — Runnable demo and camera | React/TypeScript/Vite scaffold, Konva canvas, three connected roads, two points, buffers, two valid trains, selection, pointer-centred zoom, separate pan mode, Fit Yard, Focus Train and Focus Manoeuvre |
| B — Independent model | Geometry-derived metre lengths, finite-length normal/curved points routes, explicit port links, canonical directed occupied paths, per-section IDs, analytical swept interval validation, points and adjoining fouling zones, configurable margins, reversal and domain tests |
| C — Commands and clearance | Click and constrained-drag previews through the same validator, exact destination entry, full-footprint checks, blocker explanations, minimum forward clearance distance and quantified shortfalls, boundary/stop markers, elapsed-time animation with one moving train |
| D — Scenarios and delivery | Three presets, one-entry-per-action Undo/Redo, redo-branch invalidation, Reset with animation cancellation, compact desktop controls, keyboard shortcuts, browser workflows and README |

## Checks actually performed

- Environment inspected: Node **22.18.0**, npm **11.18.0**, installed Brave **153.1.95.104**. Dependencies are pinned, with `package-lock.json`. System Node was not modified.
- `npm run typecheck` — passed. Strict checking includes application, domain tests, browser tests and both tool configuration files.
- `npm test` — **28 tests passed**. Vitest is scoped to domain tests, independently of Playwright.
- `npm run build` — passed, including its own type check. Production output is in `dist/`.
- `npm run test:ui` — **5 tests passed** in the actual installed **Brave**, headless, at **1440 × 900**. Screenshots were also visually inspected.
- Production smoke test at `http://127.0.0.1:4173/` — HTTP 200, an executed 150 m clear move ending at H @ 90 m, P01 released, no page errors, and no external requests.
- `npm ls --depth=0` — dependency tree resolved. Installation reported no known dependency vulnerabilities at that time; this is not a separate security audit.

The domain tests cover both points positions and both traversal directions, misalignment rejection in both directions, forbidden branch-to-branch moves and disconnected crossings, curve arc length, valid preset lengths, exact multi-segment occupancy, tail-plus-margin locking, adjoining fouling conflicts, reversal identity, a complete reversing shunt, analytical collision/no-tunnelling checks, separated trains sharing a road, buffer allowances, rejected/stale-command immutability, animation-distance footprints, the 75/5/70/90 m acceptance arithmetic, remaining 50 m after a head has advanced 30 m beyond the boundary, variable train lengths, curve-aware clearance, insufficient buffer room, constrained drag, history and camera isolation.

The five actual-interface tests cover:

1. Click preview and execute; clear P01; change points; reverse; follow the curve to R2; Undo and Redo.
2. Drag preview without immediate mutation; execute; verify points remain locked while the tail is present; preview and execute the remaining clearance move.
3. Rejection of both a click and a large drag through T02; the short preset's 10 m shortfall.
4. Zoom, focus and pan without changing placement; conflicting controls disabled during movement; Reset during animation, followed by a wait longer than the cancelled move to check that no stale frame commits.
5. Concrete misaligned-points rejection, exact metric entry, keyboard reversal, the 50 m remaining-clearance case, and invalidation of Redo after a new action.

Representative browser screenshots (regenerated by the UI suite):

- `test-results/yardmaster-initial.png`
- `test-results/yardmaster-shunt-complete.png`
- `test-results/yardmaster-shortfall.png`

## Known limitations

- All dimensions, clearance rules and animation speed are deliberately fictional. This is not signalling/interlocking software and does not model braking, acceleration, derailment, loading gauge, bogies or detailed vehicle-body clearances.
- Curves are fixed sampled polylines. Their rendered centreline and metric lengths agree exactly; a future editor would need geometry validation and explicit port/zone authoring.
- The supplied yard is a small acyclic graph. There is no general cyclic-route selection, automatic reversal search, or multi-command shunt optimiser. Only one explicitly commanded train moves at a time.
- A drag follows the current permitted route and saturates at its allowed end; it cannot select a different branch. Click/exact-entry previews explain misaligned alternative routes. Mouse clicks have pixel precision; exact fields and Preview clear move provide deterministic metre positions.
- The main interface targets desktop. Shorter windows scroll the train/points area; there is no mobile layout. Labels can crowd at extreme zoom, while exact occupancy and end markers remain authoritative.
- A production bundle-size advisory remains: the combined React/Konva/app JavaScript is about **576 kB minified / 178 kB gzip**. This is a build advisory, not a failed check; the local production app was exercised successfully.
- No persistence, layout editor, real-depot reconstruction, import/export, recording/replay, accounts, backend, deployment or cloud features. Reloading loses the session by design.

## Next useful increment

Keep version 1 as a verified baseline. Before adding an editor, introduce a separate layout/scenario validation pass that checks authored endpoint links, zone coverage at every junction, finite geometry and initial train placement. It would make future infrastructure editing safer without entangling UI/camera state with physical rules. Real-depot dimensions should be supplied and verified by the user rather than inferred.

See [README.md](README.md) for exact installation/run commands, controls, modelling conventions and the reversing-shunt walkthrough.

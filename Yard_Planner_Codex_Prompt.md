Build the first working version of a local desktop web application called "YardMaster".

Work in this exact project directory:
~/jouliene/yardmaster

Expand ~ using the current operating-system user's home directory. Create the directory if it does not exist. Keep project files inside it; do not substitute a different project location. Inspect any existing files, repository status and applicable AGENTS.md instructions first. Preserve unrelated work and adapt an existing project rather than overwriting it.

Implement working code, not just a proposal or a visual mockup. This specification supersedes earlier plans for non-uniform track compression and a larger first release.

1. Product goal and first-release boundary

I work as a yard master. My eventual goal is to model one or two railway depots and use their layouts to learn the yard and plan shunting movements.

For version 1, prove the essential mechanics on a small fictional yard:
- Move a three-section train along connected tracks.
- Show its entire occupied length, leading end and trailing end.
- Change points manually when their clearance zone is free.
- Explain why a proposed movement is possible or blocked.
- Calculate how far the train must advance before the points can be changed for a reversing move.
- Check that sufficient unobstructed track exists for the whole manoeuvre.

Build only this first version. Defer the visual layout editor, real-depot reconstruction, plan recording/replay, import/export, persistent storage, automatic shunting optimisation and other extensions. Keep infrastructure data separate so a layout editor can be added later. Do not add placeholder buttons for deferred features.

This is a manually maintained training/planning model, not a live railway control system. State that briefly in the README. Use clearly labelled fictional dimensions and simplified movement rules; do not invent official depot measurements or railway operating standards.

2. Environment and stack

Development: Linux Mint.
Target browser: Brave on desktop.
Design for approximately 1440 x 900 CSS pixels with mouse and keyboard.

Use:
- React.
- TypeScript with strict checking.
- Vite.
- Konva and react-konva.
- Plain CSS.
- React state/reducers and refs as needed.
- Vitest for focused domain tests.

Inspect the installed Node.js and package manager before scaffolding. Use compatible stable dependencies and a lockfile. For a new project, use npm; respect an existing package manager if the project already has one. Do not silently change the system's Node installation.

No backend, accounts, cloud services, Next.js, PWA, Electron, mobile layouts, multiplayer, 3D, additional state-management framework or external image assets. Do not deploy or publish anything.

3. Display decision: one consistent physical scale

Version 1 must use a single scale for physical distances across the entire yard, with zoom and pan.

Keep the visual style schematic and readable, but preserve lengths:
- Represent track centreline geometry in world coordinates measured in metres.
- Use the actual centreline traversal length, including curves and points routes, for movement calculations.
- For the fictional layout, derive physical lengths from that geometry. Do not maintain an inconsistent independent length value.
- Apply one uniform camera scale to both axes and to every track and train.
- Never compress individual roads, use fisheye distortion or change local scale dynamically.
- Equal-length train sections retain equal physical/display lengths at a given zoom.
- Zooming, panning and resizing affect only the camera, never occupancy or movement validity.

Use simple paths and recognisable three-section trains. Draw each section following the route with appropriate orientation; do not rotate the whole train as one rigid rectangle. Maintain exact leading/trailing-end markers and a continuous occupied-track highlight. These are authoritative for longitudinal occupancy; detailed wheel, bogie and vehicle-body physics are out of scope.

Labels, line thickness and invisible hit targets may be adjusted for readability, but do not enlarge train lengths independently of the track scale.

Provide:
- Mouse-wheel zoom centred on the pointer.
- Canvas pan, clearly separated from train dragging.
- Fit Yard.
- Focus Train: the entire selected train plus nearby points.
- Focus Manoeuvre: the train, selected points clearance boundary and proposed stopping position.

Focus actions must fit the relevant geometry without changing it. Do not move the camera automatically during an active drag. Hide decorative details when zoomed out.

4. Minimal domain model

Keep domain logic independent of React, Konva and browser APIs. Prefer a small structure such as src/domain, src/canvas, src/components and src/data.

Separate:
- Layout: tracks, explicit connections, points, buffer stops, geometry and clearance boundaries.
- Scenario: train placements, section lengths and points positions.
- UI/camera state: selection, viewport and interaction mode.

Use stable IDs. A train's authoritative placement is a directed occupied path and metric positions along it, not screen coordinates. Preserve enough path information to locate every section and both ends while spanning several segments or reversing.

Derive total train length from section lengths using a documented convention for couplers/gaps. Use 3 x 25 m = 75 m as a fictional starting example; do not hardcode all trains to this configuration.

Important invariants:
- Visual crossings or nearby endpoints do not imply connectivity.
- Ordinary points have a common/toe port and two branches.
- The selected position permits common-to-selected-branch travel in either direction.
- A direct branch-to-branch shortcut is invalid.
- For this simplified prototype, movement through misaligned points is rejected in either direction.
- Traversal through points has physical length; it is not a zero-distance teleport.
- Occupancy is a set of distance intervals covering the whole train.
- Two trains may share a long track if their intervals and configured clearance do not conflict.
- Points cannot change while any train occupies their defined clearance zone, including a relevant fouling area on an adjoining track.
- The zone becomes free only after the entire train clears it.
- A reversal swaps the active leading end without moving the train, changing its occupied path or scrambling section identities.

Use explicit, simplified clearance intervals and configurable demo margins. Document their assumptions. A full signalling/interlocking system is out of scope.

5. Interaction and movement

First implement:
1. Select a train.
2. Select its travel direction/leading end.
3. Click a destination position on a connected track.
4. Preview the route, stopping position and any blockers.
5. Execute a valid move with simple animation.

Then implement constrained mouse dragging using the same validator:
- Keep the train on the connected route permitted by the current points.
- Never jump to a nearby parallel road.
- Never skip an obstacle because the pointer or animation frame advanced a large distance.
- Treat dragging as a preview until a valid command is committed.
- A rejected command must leave the scenario unchanged.

Always validate the swept path and the resulting full-train footprint, not just the destination of the leading end.

Display concrete reasons:
- Points P02 are set to the other route.
- Train T02 occupies the required interval.
- The whole train cannot fit before the stopping limit.
- Points P01 remain occupied by T01.

Do not silently switch points or teleport trains to make a requested move succeed. If a connection would require a points change, identify it. If no direct movement exists in the selected direction, say so. Support reversing shunts through explicit successive user commands; do not attempt to solve an entire shunt automatically.

Allow only one moving train at a time. Disable conflicting commands during animation. Advance along physical path distance using elapsed time, independent of frame rate. Keep live head/tail positions consistent with that distance.

Provide Undo, Redo and Reset Scenario. Record a completed train movement or points change as one action, not a history entry per frame. Reset must safely cancel an animation. A new action after Undo clears the redo branch.

6. Critical feature: enough room to clear points and reverse

For a selected train and points zone, preview the minimum additional forward movement required to clear that zone along the selected route.

Show:
- Total train length.
- Distance still needed to clear the relevant boundary.
- Proposed leading-end stopping position.
- Remaining distance to the allowed stopping limit or first obstruction.
- A quantified shortfall when there is not enough room.

Highlight the clearance boundary and proposed stopping position. This calculation must account for the entire occupied route, points settings, other trains and end-of-track limits.

Use this fictional acceptance example:
- Train length: 75 m.
- Required trailing-end margin beyond the selected clearance boundary: 5 m.
- Therefore the leading end must reach 80 m beyond that boundary.
- With only 70 m available beyond the boundary up to the allowed stopping limit, the movement cannot clear the points: the shortfall is 10 m.
- With 90 m available, that length condition passes with 10 m remaining, provided other checks pass.
- If the leading end is already 30 m beyond the boundary, the remaining movement is 50 m, not 80 m.

The 5 m margin is a configurable demo assumption, not a claimed railway rule. Define the allowed stopping limit after any buffer-stop allowance and do not subtract that allowance twice. Measure distances along the route, including curves and points.

7. Demo and interface

Create a small, geometrically consistent fictional yard with:
- Three roads.
- Two points.
- At least one curved connection.
- Buffer stops and readable track/points IDs.
- Two trains, including the three-section 75 m example.
- Sufficient geometry to demonstrate a forward move, clearing points, changing points and reversing into a different road.

Make the initial placement valid. Do not create the appearance of three roads without actual traversable connections.

Provide a few lightweight preset scenarios using the same domain model:
- A successful reversing shunt.
- A route blocked by another train.
- Insufficient room to clear points.

Keep the interface compact: toolbar, large central canvas, selection/details panel and status area. Show selected train ID, length, direction and relevant points state. Use readable colours plus text/symbols for status. Keep unnecessary decoration out of the way.

Do not add a scenario editor in version 1. Presets and Reset are sufficient.

8. Implementation order

Milestone A: inspect the project, scaffold/adapt it, render the valid demo and implement selection, zoom, pan and camera focus.

Milestone B: implement the independent metric domain model, points transitions, full-train occupancy, collision/clearance validation and reversing. Add domain tests.

Milestone C: add click-to-preview/execute, movement-to-clear feedback and animation. Then connect constrained dragging to the same engine.

Milestone D: add presets, Undo/Redo/Reset, polish the desktop UI, verify the app and document it.

Work in this order and keep the app runnable between milestones. Complete all four milestones for version 1; do not stop after scaffolding, and do not expand into deferred features.

9. Required verification and delivery

Test the behaviour that can make this planner misleading:
- Correct points routing in both positions and both directions.
- Rejection of branch-to-branch shortcuts and disconnected crossings.
- Correct occupied intervals when the train spans multiple segments.
- Points remain locked until the tail and configured margin clear the zone.
- Occupancy of an adjoining fouling interval also blocks a conflicting movement.
- Reversal preserves physical placement and section identities.
- No overlap with another train and no tunnelling past an obstruction.
- Separate trains on the same road are allowed when clearance permits.
- Buffer stops and insufficient usable length block movement.
- The 75 m / 5 m example produces the stated results.
- Camera changes do not alter physical results.
- Rejected commands do not mutate state.
- Undo/Redo/Reset restore consistent train and points states.

Use focused tests rather than a large UI snapshot suite. Verify both click movement and dragging through the actual interface when browser tooling is available.

Provide and run package scripts for development, type checking, production build and tests. Fix failures before declaring completion. State which browser you actually tested. If Brave is unavailable, state that and provide a short Brave smoke-test checklist.

Create:
- README.md with exact Linux installation/run commands, controls, assumptions and a short reversing-shunt walkthrough.
- PROJECT_STATUS.md with implemented milestones, checks performed, known limitations and the next useful increment.

Explain progress and decisions to me in Russian. Keep code, UI labels and project documentation in English.

Begin with a brief plan, then write and verify the code. Continue through ordinary implementation decisions without repeatedly asking for permission. If a real blocker prevents completion, explain it precisely and leave a reproducible checkpoint.

At the end, report the project directory, exact commands to run it, verified behaviour, tests actually run and remaining limitations. Do not claim success from compilation alone: the movement model and interactive workflow must work.

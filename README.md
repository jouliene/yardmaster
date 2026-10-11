# YardMaster

A local desktop shunting lab for a small fictional railway yard. Built with React, strict TypeScript, Vite and react-konva/Konva, with independent metric domain logic and Vitest tests. Designed around a 1440 × 900 desktop viewport, mouse and keyboard, and Brave.

**This is a manually maintained training/planning model, not a live railway control system.** Every dimension, margin and movement rule below is fictional and simplified. None represents an official depot measurement or railway operating standard.

## Install and run on Linux

Use an existing compatible Node installation: Node 22.12+ within the 22.x line, 24.x, or 26+. Development was verified with Node 22.18.0 and npm 11.18.0. The project does not install or modify system Node.

```bash
cd /home/neo/jouliene/yardmaster
node --version
npm --version
npm ci
npm run dev
```

Open the printed local URL in Brave, normally **http://127.0.0.1:5173/**. The server binds to loopback. Nothing is deployed; there is no backend or external asset request.

```bash
cd /home/neo/jouliene/yardmaster
npm run typecheck
npm test
npm run build
npm run preview
```

`build` includes strict type checking and writes `dist/`. `preview` serves that production build, normally at http://127.0.0.1:4173/. Stop either server with Ctrl+C. `npm run test:watch` starts interactive domain testing.

For reproducible actual-browser tests using the installed Brave executable:

```bash
cd /home/neo/jouliene/yardmaster
npm run test:ui
# If Brave lives elsewhere:
BRAVE_PATH=/absolute/path/to/brave-browser npm run test:ui
```

Playwright starts/reuses the local Vite server. It uses Brave headlessly at 1440 × 900; it does not download a browser. Its isolated test browser uses `--no-sandbox` for compatibility with restricted CI containers. This flag is not part of normal application use. Screenshots and failure traces go into ignored `test-results/`.

## Controls

| Action | Control |
| --- | --- |
| Select a train | Click its body, or T01/T02 in the side panel |
| Choose travel direction | Click a destination or drag either way; the appropriate cab is selected automatically |
| Preview a move | Click a track ahead of the active end |
| Constrained drag | Drag any part of the train in Select / move mode; release keeps the preview |
| Exact metric destination | Expand **Enter exact destination**, choose track and metres from its geometry start, then Preview |
| Commit a valid preview | **Execute movement**, or **Enter** |
| Discard a preview | Cancel preview, or **Escape** |
| Select points | Click their symbol, or the points selector |
| Change points | Set Normal / Set Reverse, enabled only when the full zone plus margin is free |
| Zoom | Wheel, centred on the pointer |
| Pan | Middle-button drag, or switch to Pan mode; **P** toggles modes |
| Camera | Fit Yard (**F**), Focus Train, Focus Manoeuvre |
| History | Undo / Redo, or Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z |
| Restore a preset | Reset; safely cancels an active animation and clears history |

Keyboard shortcuts are suspended while typing into fields. Enter on a focused button activates that button normally. Only one train can move at once. Selection, previews, points, presets and history are locked during animation. Reset remains available. Camera actions never change a movement; automatic camera fitting is suppressed during dragging. At shorter desktop heights, the train/points area scrolls while the movement command stays available.

Both ends have cabs. No manual leading-end selection is needed. A preview derives the movement direction without changing the scenario; Cancel restores the previous display, and Execute commits direction and movement as one history action. The white circle marks the exact moving end for the preview or last movement; the amber bar marks the exact trailing end. The continuous coloured centreline is the authoritative occupied length. Dashed teal/red lines show the proposed route. Gold marks the selected clearance boundary; violet marks the minimum clear stopping position. The selected points zone has a pale gold highlight. Inactive points routes are dashed grey. A rejected preview explains the blocker and cannot be executed.

Dragging projects displacement of the grabbed point onto the permitted routes from both ends and uses the direction you drag. It never uses a nearby road as a new connection. It may follow that route even if the pointer leaves its centreline; look at the preview and target label before executing. At the route's allowed end the drag target saturates. Collision checks still reject a long drag through another train. Use exact input when pixel-level selection is insufficient.

## Reversing-shunt walkthrough

1. Load **01 · Reversing shunt**. T01 is 75 m long, with leading end A at R1 @ 20 m and trailing end at R1 @ 95 m. A faces toward P01 and H.
2. Select P01. The room-to-reverse card reports **150 m** additional movement. Choose **Preview clear move**, then **Execute movement**. Alternatively click H near the violet marker, or enter H @ 90 m exactly.
3. T01's head is now H @ 90 m and its tail H @ 165 m. P01's H boundary is at 170 m, leaving the required 5 m tail margin. P01 is free.
4. Set P01 to **Reverse**. Leave P02 **Normal**.
5. Click R2, or preview **R2 @ 110 m** using exact input. The cab facing R2 is chosen automatically; no separate reversal command is needed. Execute. The train follows P01's curved route, the ladder and P02's normal route. Its final occupied interval is R2 @ 35–110 m.
6. Undo and Redo restore complete movements and points states, one action at a time. Automatic direction changes are included in the movement action.

The other presets use identical infrastructure:

- **02 · Occupied route:** T02 occupies H @ 87–127 m. A move beyond it is rejected even if the destination itself is empty.
- **03 · Not enough room:** T02 occupies H @ 57–97 m. The 3 m train clearance makes H @ 100 m the allowed limit when approaching it from P01. From the P01 boundary at H @ 170 m, only 70 m remain: a 75 m train plus 5 m tail margin needs 80 m, so the shortfall is **10 m**.

## Metric model and assumptions

Infrastructure lives in `src/data/yard.ts`; scenario presets are separate records. The graph has explicit endpoint links:

```text
                    P01 normal ── R1 ── buffer
buffer ── H ── P01 <
                    P01 curved ── L ── P02 < normal ── R2 ── buffer
                                           curved ── R3 ── buffer
```

- World coordinates are metres. H runs from x = −180 to 0 at y = 0; R1 starts at (40, 0); R2 at (110, 36); R3 at (110, 72). All road buffers have x = 330. All positions displayed as `track @ metres` are measured from that segment's first geometry vertex, regardless of travel direction.
- H is 180 m, R1 290 m, L 30 m, R2/R3 220 m. Each normal points route is 40 m. Each curved route is approximately 55.37 m, derived from its sampled centreline. The exact sum of polyline edges is authoritative; no independent length property exists.
- Curves use 40 short line spans. Track rendering, occupied highlights, section paths and distance calculations use the same vertices. There is one camera scale for both axes and all infrastructure. Zoom, pan and resize only change the camera. The 20 m scale bar uses that same scale. Labels, widths and hit targets can vary for readability; longitudinal train lengths do not.
- Connections are explicit, never inferred from proximity or a visual crossing. A points route has a common/toe endpoint and one branch endpoint. Only the selected route can be traversed, in either direction. Direct branch-to-branch travel is impossible without first moving clear and requesting a destination in the opposite direction. Misaligned points reject a movement; they are never switched automatically.
- Each train stores its directed **canonical B → A occupied path**, plus an active leading-end flag. Sections retain their stable IDs and order along that canonical path after reversal. Movement appends travelled intervals and trims the trailing length. It can span multiple tracks and points segments.
- T01 has three 25 m sections, giving 75 m total; T02 has two 20 m sections. Section length includes its allocated coupler space: section lengths sum directly, with no extra physical gap. Small decorative insets separate visible bodies inside those intervals. The continuous occupancy highlight and end markers remain exact. This is not a bogie/body dynamics model.
- Buffers reserve **5 m** from the physical end. `forwardRoute` already returns this allowed stopping limit; clearance calculations never deduct it again. Other trains require **3 m** longitudinal separation. Equality at the configured separation is permitted (numeric epsilon 1e−7 m).
- P01's raw clearance zone is H @ 170–180 m, both complete P01 routes, R1 @ 0–8 m, and L @ 0–8 m. P02's is L @ 22–30 m, both complete P02 routes, R2 @ 0–8 m, and R3 @ 0–8 m. The last intervals explicitly model adjoining fouling areas.
- Points occupancy expands those intervals by the configurable **5 m** demo margin. These conservative zones also exclude a conflicting movement on another branch while occupied. One train's occupation anywhere in a points zone prevents other trains from entering that zone, even with disjoint longitudinal intervals on different branches. Trains can otherwise share a long road with adequate interval separation. The demo's adjoining intervals cover every turnout connection; this is not a general signalling/interlocking engine.
- `clearancePlan` finds the last selected-zone exit along the entire occupied plus prospective route. It places the trailing end 5 m beyond that boundary, then checks the full route, points, other trains and usable stopping limit. If the head is already 30 m beyond the boundary, a 75 m train needs **50 m** more, not 80 m. With an allowed limit 70 m beyond the boundary the shortfall is 10 m; with 90 m the remaining room is 10 m. Once the zone and margin are fully behind the tail, the calculation reports already clear.
- Swept interval checks are analytical, independent of pointer distance and animation frame size. Only a successfully revalidated command can start moving. Animation advances at a fictional **35 m/s**, using elapsed time; no acceleration, braking or operational speed model is implied. The whole move is validated before animation, and conflicting edits remain disabled until completion.
- A completed move (including its automatic cab change) or points change creates one history entry. Animation frames and previews create none. Rejected commands return the unchanged source scenario. A new action after Undo clears Redo; Reset clears both stacks and cancels pending animation callbacks.

## Source map

| Location | Responsibility |
| --- | --- |
| `src/domain/types.ts` | Layout, ports, intervals, trains and scenarios |
| `src/domain/geometry.ts` | Arc lengths, slicing, projection and exact path geometry |
| `src/domain/engine.ts` | Routes, occupancy, points, collision checks, drag targets and clearance |
| `src/domain/history.ts` | Immutable action history |
| `src/data/yard.ts` | Fictional infrastructure and three initial scenarios |
| `src/canvas/` | Pure camera math and Konva rendering/pointer interactions |
| `src/App.tsx` | UI selection, previews, reducer state and elapsed-time animation |
| `src/domain/engine.test.ts` | Focused geometry, movement, clearance, history and camera tests |
| `tests/ui.spec.ts` | Actual Brave click/drag and complete shunt workflow tests |

## Version 1 boundaries

No layout editor, real-depot reconstruction, saved sessions, import/export, recording/replay, automatic shunt solving, backend, accounts, cloud services, mobile UI or deployment. Reloading the page starts a fresh default scenario. One direct movement is planned at a time; reversing shunts require successive explicit commands. Buffer overruns, collisions, points and fouling checks follow only the documented fictional model. Longitudinal occupancy is authoritative; detailed vehicle-body clearance is outside scope.

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for verification and the next useful increment.

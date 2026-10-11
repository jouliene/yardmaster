import { useEffect, useReducer, useRef, useState } from 'react';
import YardCanvas from './canvas/YardCanvas';
import { makeScenario, presets, yard } from './data/yard';
import { availableMovement, changePoints, clearancePlan, commitMove, lead, planDrag, planMove, pointsOccupants, scenarioAtMovement, trailing, trainLength, withMovementDirection, type Movement } from './domain/engine';
import { historyReducer, newHistory } from './domain/history';
import type { Destination, Scenario, Vec } from './domain/types';

const metres = (n: number) => `${Math.abs(n) < 0.05 ? '0.0' : n.toFixed(1)} m`;
const location = (p: Destination) => `${p.segment} @ ${metres(p.at)}`;
export default function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => newHistory(makeScenario()));
  const [selected, setSelected] = useState('T01'), [selectedPoints, setSelectedPoints] = useState('P01');
  const [gesture, setGesture] = useState(false);
  const [focus, setFocus] = useState<{ id: number; kind: 'yard' | 'train' | 'manoeuvre' }>({ id: 0, kind: 'yard' });
  const [preview, setPreview] = useState<Movement | undefined>();
  const [animated, setAnimated] = useState<Scenario | undefined>();
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState('Select T01, then click a track or drag the train to preview a movement.');
  const [targetTrack, setTargetTrack] = useState('H'), [targetMetres, setTargetMetres] = useState('90');
  const animation = useRef<number | undefined>(undefined), generation = useRef(0);
  const grab = useRef<Vec>({ x: 0, y: 0 });
  const busy = animated !== undefined, locked = busy || gesture;
  const scenario = animated ?? (preview ? withMovementDirection(history.present, selected, preview.leading) : history.present);
  const train = scenario.trains.find(t => t.id === selected)!;
  const clearance = clearancePlan(yard, scenario, selected, selectedPoints);
  const available = availableMovement(yard, scenario, train);
  const occupants = pointsOccupants(yard, scenario, selectedPoints);
  const preset = presets.find(p => p.id === history.present.id)!;
  const head = lead(train), tail = trailing(train);

  const cancelAnimation = () => {
    generation.current++;
    if (animation.current !== undefined) cancelAnimationFrame(animation.current);
    animation.current = undefined; setAnimated(undefined); setProgress(0);
  };
  useEffect(() => () => { if (animation.current !== undefined) cancelAnimationFrame(animation.current); generation.current++; }, []);
  const clearPreview = () => setPreview(undefined);
  const select = (id: string) => { if (busy) return; setSelected(id); clearPreview(); };
  const focusOn = (kind: 'yard' | 'train' | 'manoeuvre') => { if (!gesture) setFocus(f => ({ id: f.id + 1, kind })); };
  const showPreview = (result: Movement) => {
    const target = result.stop;
    setPreview(result); setNotice(result.reason);
    setTargetTrack(target.segment); setTargetMetres(target.at.toFixed(1));
  };
  const destination = (target: Destination, id = selected) => {
    if (!busy) showPreview(planMove(yard, history.present, id, target));
  };
  const execute = () => {
    if (locked || !preview?.valid) return;
    const checked = commitMove(yard, history.present, preview);
    if (checked.error) { setNotice(checked.error); clearPreview(); return; }
    const command = preview, token = ++generation.current;
    const start = performance.now(), speed = 35; // Demonstration speed, m/s.
    setAnimated(scenarioAtMovement(command, 0)); setProgress(0); setNotice(`Moving ${selected} · ${metres(command.distance)} at demo speed 35 m/s`);
    const tick = (now: number) => {
      if (generation.current !== token) return;
      const distance = Math.min(command.distance, (now - start) * speed / 1000);
      setProgress(distance / command.distance);
      if (distance >= command.distance) {
        dispatch({ type: 'commit', scenario: checked.scenario });
        setAnimated(undefined); setPreview(undefined); animation.current = undefined;
        setNotice(`${command.trainId} moved ${metres(command.distance)}. One action added to history.`);
      } else {
        setAnimated(scenarioAtMovement(command, distance));
        animation.current = requestAnimationFrame(tick);
      }
    };
    animation.current = requestAnimationFrame(tick);
  };
  const reset = (id = history.present.id) => {
    cancelAnimation(); dispatch({ type: 'reset', scenario: makeScenario(id) }); clearPreview(); setGesture(false);
    setSelected('T01'); setSelectedPoints('P01'); setNotice('Scenario reset. Train and points placements restored.');
    setTargetTrack('H'); setTargetMetres('90'); focusOn('yard');
  };
  const undoRedo = (type: 'undo' | 'redo') => { if (locked) return; dispatch({ type }); clearPreview(); setNotice(type === 'undo' ? 'Last action undone.' : 'Action restored.'); };
  const togglePoints = (id = selectedPoints) => {
    if (locked) return;
    setSelectedPoints(id); clearPreview();
    const result = changePoints(yard, history.present, id);
    if (result.error) setNotice(result.error);
    else { dispatch({ type: 'commit', scenario: result.scenario }); setNotice(`Points ${id} set to ${result.scenario.points[id]}.`); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea, [contenteditable="true"]')) return;
      if (e.key === 'Enter' && (e.target as HTMLElement).closest('button')) return;
      if (e.key === 'Escape' && !busy) { clearPreview(); setNotice('Preview cancelled. Scenario unchanged.'); }
      if (locked) return;
      if (e.key.toLowerCase() === 'f') focusOn('yard');
      if (e.key === 'Enter') execute();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoRedo(e.shiftKey ? 'redo' : 'undo'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return <main>
    <header><div className="brand-mark">Y<span>╱</span></div><div><h1>YardMaster</h1><span className="brand-sub">SHUNTING LAB</span></div><div className="header-divider"/><div className="header-description">A little yard.<br/><strong>Room to think.</strong></div><div className="header-right"><span className="pill">LOCAL SESSION</span><small>Fictional layout · v0.1</small></div></header>
    <nav aria-label="Main controls">
      <label className="scenario-select">SCENARIO<select aria-label="Scenario" value={history.present.id} disabled={locked} onChange={e => reset(e.target.value)}>{presets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <div className="toolbar-divider"/>
      <span className="navigation-hint">Drag background · Click points to switch</span>
      <div className="toolbar-spacer"/>
      <button disabled={gesture} onClick={() => focusOn('yard')}>Fit Yard</button><button disabled={gesture} onClick={() => focusOn('train')}>Focus Train</button><button disabled={gesture} onClick={() => focusOn('manoeuvre')}>Focus Manoeuvre</button>
      <div className="toolbar-divider"/>
      <button disabled={locked || !history.past.length} onClick={() => undoRedo('undo')}>↶ Undo</button><button disabled={locked || !history.future.length} onClick={() => undoRedo('redo')}>↷ Redo</button><button onClick={() => reset()}>Reset</button>
    </nav>
    <div className="workspace">
      <section className="yard-area">
        <div className="scenario-hint"><span>EXERCISE {preset.id === 'shunt' ? '01' : preset.id === 'blocked' ? '02' : '03'}</span><p>{preset.hint}</p></div>
        <YardCanvas layout={yard} scenario={scenario} selected={selected} selectedPoints={selectedPoints} onSelect={select}
          onTogglePoints={togglePoints}
          onDestination={destination} onDragStart={(_, p) => { grab.current = p; }}
          onDrag={(id, p) => { if (!busy) showPreview(planDrag(yard, history.present, id, grab.current, p)); }}
          onGesture={setGesture} busy={busy} focus={focus} preview={preview}
          boundary={clearance.boundary} proposed={clearance.stop}/>
        <div className="canvas-help"><span><kbd>Drag background</kbd> Pan <kbd>Click track</kbd> Destination <kbd>Wheel</kbd> Zoom <kbd>Enter</kbd> Execute</span><span>Drag a train either way to preview.</span></div>
      </section>
      <aside aria-label="Movement planner">
        <div className="planner-context">
        <section className="panel-section">
          <div className="eyebrow">01 / SELECTED TRAIN</div>
          <div className="section-heading"><h2 data-testid="selected-train">{selected}</h2><span className="pill mint">{train.sections.length} SECTIONS</span></div>
          <div className="train-tabs">{scenario.trains.map(t => <button key={t.id} disabled={locked} className={selected === t.id ? 'active' : ''} onClick={() => select(t.id)}>{t.id}<span>{trainLength(t)} m</span></button>)}</div>
          <div className="metric-row"><span>Total occupied length</span><strong>{metres(trainLength(train))}</strong></div>
          <div className="metric-row"><span>Moving end (automatic)</span><strong data-testid="leading-position">{train.leading} · {location(head)}</strong></div>
          <p className="compact">Cabs at both ends. Click or drag either way.</p>
          <div className="metric-row"><span>Other end</span><strong data-testid="trailing-position">{location(tail)}</strong></div>
        </section>
        <section className="panel-section">
          <div className="eyebrow">02 / POINTS & CLEARANCE</div>
          <div className="points-row"><select aria-label="Selected points" value={selectedPoints} disabled={locked} onChange={e => { setSelectedPoints(e.target.value); clearPreview(); }}>{Object.keys(yard.points).map(id => <option key={id}>{id}</option>)}</select><span data-testid="points-state" className="points-position">{scenario.points[selectedPoints]}</span><button disabled={locked || occupants.length > 0} onClick={() => togglePoints()}>Set {scenario.points[selectedPoints] === 'normal' ? 'Reverse' : 'Normal'}</button></div>
          <div className={`zone-status ${occupants.length ? 'amber-text' : 'mint-text'}`} data-testid="points-lock">{occupants.length ? `▣ Locked by ${occupants.join(', ')} · includes 5 m margin` : '◇ Clearance zone free'}</div>
          <div className={`clearance-card ${clearance.valid ? '' : 'blocked'}`}>
            <div className="clearance-title">{clearance.valid ? '◉' : '△'} ROOM TO REVERSE</div>
            <div className="clearance-big" data-testid="clearance-distance">{metres(clearance.additional)}<span>additional movement</span></div>
            <div className="metric-row"><span>Trailing-end margin</span><strong>{yard.margins.points} m</strong></div>
            <div className="metric-row"><span>Leading-end clear stop</span><strong>{clearance.stop ? location(clearance.stop) : clearance.additional ? 'Beyond reachable track' : 'Already clear'}</strong></div>
            <div className="metric-row"><span>{clearance.shortfall ? 'Shortfall' : 'Room after clear stop'}</span><strong data-testid="room-result">{metres(clearance.shortfall || clearance.remaining)}</strong></div>
            <p>{clearance.reason}</p>
            <button className="full" disabled={locked || !clearance.movement} onClick={() => { setPreview(clearance.movement ? { ...clearance.movement, source: history.present } : undefined); setNotice(clearance.reason); }}>Preview clear move</button>
          </div>
        </section>
        </div><section className="panel-section destination-section">
          <div className="eyebrow">03 / MOVEMENT COMMAND</div>
          <details className="exact-destination"><summary>Enter exact destination</summary>
          <form onSubmit={e => { e.preventDefault(); const at = Number(targetMetres); if (Number.isFinite(at)) destination({ segment: targetTrack, at }); }}>
            <div className="destination-fields"><label>Track<select aria-label="Destination track" value={targetTrack} disabled={locked} onChange={e => setTargetTrack(e.target.value)}>{Object.keys(yard.segments).map(id => <option key={id}>{id}</option>)}</select></label><label>Metres from start<input aria-label="Destination metres" type="number" step="0.1" required value={targetMetres} disabled={locked} onChange={e => setTargetMetres(e.target.value)}/></label><button disabled={locked} type="submit">Preview</button></div>
          </form></details>
          <div className="metric-row"><span>Clear travel ahead</span><strong>{metres(available.distance)}</strong></div>
          <p className="limit-note">{available.reason}</p>
          <div className={`movement-result ${preview ? preview.valid ? 'valid' : 'invalid' : ''}`} role="status" data-testid="movement-result">{preview ? <><strong>{preview.valid ? '✓ READY TO MOVE' : '× MOVEMENT BLOCKED'}</strong><p>{preview.reason}</p><span>{location(preview.stop)} · {metres(preview.distance)}</span></> : <span>No movement previewed</span>}</div>
          <button className="execute full" disabled={locked || !preview?.valid} onClick={execute}>{busy ? `Moving… ${Math.round(progress * 100)}%` : 'Execute movement'}<span>↗</span></button>
          {preview && !busy && <button className="cancel full" disabled={gesture} onClick={() => { clearPreview(); setNotice('Preview cancelled. Scenario unchanged.'); }}>Cancel preview</button>}
        </section>
      </aside>
    </div>
    <footer><span className={preview && !preview.valid ? 'status-dot blocked-dot' : 'status-dot'}/><span role="status" data-testid="status">{notice}</span><small>{history.past.length} actions · Demo rules, fictional dimensions</small></footer>
  </main>;
}

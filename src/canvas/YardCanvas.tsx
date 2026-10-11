import { useEffect, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { Destination, Interval, Layout, Scenario, Vec } from '../domain/types';
import { cutPath, distance, length, pathLength, pathPoints, pathPosition, pointAt, project } from '../domain/geometry';
import { fit, toWorld, zoom, type Camera } from './camera';
import { pointsOccupants } from '../domain/engine';

interface Props {
  layout: Layout; scenario: Scenario; selected: string; selectedPoints: string;
  onSelect: (id: string) => void; onPoints: (id: string) => void;
  onTogglePoints: (id: string) => void;
  onDestination?: (d: Destination) => void; onDrag?: (id: string, p: Vec) => void;
  onDragStart?: (id: string, p: Vec) => void;
  onGesture?: (active: boolean) => void; busy?: boolean;
  focus: { id: number; kind: 'yard' | 'train' | 'manoeuvre' };
  preview?: { path: Interval[]; stop?: Destination; valid: boolean };
  boundary?: Destination; proposed?: Destination;
}
const flat = (points: Vec[]) => points.flatMap(p => [p.x, p.y]);
function interactionOf(target: Konva.Node): 'train' | 'points' | 'track' | 'background' {
  let node: Konva.Node | null = target;
  while (node) {
    const kind: unknown = node.getAttr('interaction');
    if (kind === 'train' || kind === 'points' || kind === 'track') return kind;
    node = node.getParent();
  }
  return 'background';
}
export default function YardCanvas(props: Props) {
  const { layout, scenario, selected, selectedPoints, busy } = props;
  const host = useRef<HTMLDivElement>(null), stage = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [camera, setCamera] = useState<Camera>({ x: 350, y: 250, scale: 1.5 });
  const [mapPoints, setMapPoints] = useState<string | null>(null);
  const [cursor, setCursor] = useState('grab');
  const suppressClick = useRef(false);
  const gesture = useRef<{ type: 'pan' | 'train'; start: Vec; camera: Camera; train?: string; dragged: boolean } | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (gesture.current) return;
    const train = scenario.trains.find(t => t.id === selected)!;
    let points = Object.values(layout.segments).flatMap(s => s.geometry);
    if (props.focus.kind !== 'yard') {
      points = pathPoints(layout, train.path);
      const nearby = Object.values(layout.points).map(p => ({ point: p.at, gap: Math.min(...points.map(v => distance(p.at, v))) })).sort((a, b) => a.gap - b.gap);
      points.push(...nearby.filter((p, i) => i === 0 || p.gap < 100).map(p => p.point));
      if (props.focus.kind === 'manoeuvre') {
        points.push(layout.points[selectedPoints].at);
        if (props.boundary) points.push(pointAt(layout.segments[props.boundary.segment], props.boundary.at));
        if (props.proposed) points.push(pointAt(layout.segments[props.proposed.segment], props.proposed.at));
        if (props.preview) points.push(...pathPoints(layout, props.preview.path));
      }
    }
    setCamera(fit(points, size.width, size.height));
    // Focus is an explicit camera action. Scenario animation never follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus.id, size.width, size.height]);
  const pointer = () => stage.current?.getPointerPosition() ?? { x: 0, y: 0 };
  const cursorFor = (target: Konva.Node) => {
    const kind = interactionOf(target);
    if (busy && kind !== 'background') return 'not-allowed';
    return kind === 'points' ? 'pointer' : kind === 'track' ? 'crosshair' : 'grab';
  };
  const endGesture = () => { gesture.current = null; props.onGesture?.(false); };
  const labelSize = 11 / camera.scale;
  const popupPoints = mapPoints && mapPoints === selectedPoints ? layout.points[mapPoints] : undefined;
  const popupLocks = popupPoints ? pointsOccupants(layout, scenario, popupPoints.id) : [];
  const marker = (d: Destination | undefined, color: string, label: string) => {
    if (!d) return null;
    const p = pointAt(layout.segments[d.segment], d.at);
    return <Group key={label} listening={false}><Line points={[p.x, p.y - 8 / camera.scale, p.x, p.y + 8 / camera.scale]} stroke={color} strokeWidth={2 / camera.scale}/><Text x={p.x + 5 / camera.scale} y={p.y + 12 / camera.scale} text={label} fill={color} fontSize={labelSize}/></Group>;
  };
  return <div className="canvas-host" style={{ cursor }} ref={host} data-testid="yard-canvas" onContextMenu={e => e.preventDefault()} onPointerCancel={() => { suppressClick.current = true; endGesture(); setCursor('grab'); }}>
    <div className="canvas-caption"><span className="live-dot"/> FICTIONAL YARD / METRIC VIEW <span>North Junction</span></div>
    <Stage ref={stage} width={size.width} height={size.height}
      onWheel={e => { e.evt.preventDefault(); if (!gesture.current) setCamera(c => zoom(c, pointer(), e.evt.deltaY > 0 ? 0.9 : 1 / 0.9)); }}
      onPointerDown={e => {
        const kind = interactionOf(e.target);
        if (e.evt.button === 1 || (e.evt.button === 0 && kind !== 'train' && kind !== 'points')) {
          suppressClick.current = false; setMapPoints(null);
          gesture.current = { type: 'pan', start: pointer(), camera, dragged: false };
          props.onGesture?.(true); setCursor('grabbing'); e.evt.preventDefault();
        }
      }}
      onPointerMove={e => {
        const g = gesture.current;
        if (!g) { setCursor(cursorFor(e.target)); return; }
        const p = pointer();
        if (distance(p, g.start) > 4) { g.dragged = true; suppressClick.current = true; }
        if (g.type === 'pan' && g.dragged) setCamera({ ...g.camera, x: g.camera.x + p.x - g.start.x, y: g.camera.y + p.y - g.start.y });
        else if (g.dragged && g.train) props.onDrag?.(g.train, toWorld(p, camera));
      }}
      onPointerUp={e => { endGesture(); setCursor(cursorFor(e.target)); }}
      onPointerLeave={() => { if (gesture.current) suppressClick.current = true; endGesture(); setCursor('grab'); }}>
      <Layer x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale}>
        {Array.from({ length: 29 }, (_, i) => <Line key={`x${i}`} points={[-220 + i * 20, -120, -220 + i * 20, 220]} stroke="#203141" strokeWidth={0.5 / camera.scale} listening={false}/>)}
        {Array.from({ length: 18 }, (_, i) => <Line key={`y${i}`} points={[-220, -120 + i * 20, 360, -120 + i * 20]} stroke="#203141" strokeWidth={0.5 / camera.scale} listening={false}/>)}
        {layout.points[selectedPoints].zone.map((z, i) => <Line key={`zone${i}`} points={flat(pathPoints(layout, [z]))} stroke="#dcae53" strokeWidth={14 / camera.scale} opacity={0.13} listening={false}/>)}
        {Object.values(layout.segments).map(s => {
          const active = !s.gate || scenario.points[s.gate.points] === s.gate.position;
          const middle = pointAt(s, length(s) * 0.65);
          return <Group key={s.id}>
            <Line interaction="track" points={flat(s.geometry)} stroke={active ? '#718799' : '#394a58'} strokeWidth={3 / camera.scale} dash={active ? undefined : [5 / camera.scale, 5 / camera.scale]} hitStrokeWidth={18 / camera.scale}
              onPointerClick={e => { if (busy || suppressClick.current || e.evt.button !== 0) return; props.onDestination?.({ segment: s.id, at: project(s, toWorld(pointer(), camera)).at }); }}/>
            {!s.gate && <Text x={middle.x - 30 / camera.scale} y={middle.y - 24 / camera.scale} text={s.label} fontSize={labelSize} fill="#9bacba" listening={false}/>}
          </Group>;
        })}
        {layout.buffers.map(b => {
          const p = pointAt(layout.segments[b.segment], b.end === 'a' ? 0 : length(layout.segments[b.segment]));
          return <Group key={b.segment} listening={false}><Line points={[p.x, p.y - 4, p.x, p.y + 4]} stroke="#b4c0cb" strokeWidth={4 / camera.scale}/><Text x={p.x - 16 / camera.scale} y={p.y + 9 / camera.scale} text="STOP" fontSize={9 / camera.scale} fill="#7c90a1"/></Group>;
        })}
        {props.preview && <Line points={flat(pathPoints(layout, props.preview.path))} stroke={props.preview.valid ? '#5dd9c1' : '#fb8d7e'} strokeWidth={6 / camera.scale} opacity={0.65} dash={[8 / camera.scale, 5 / camera.scale]} listening={false}/>}
        {scenario.trains.map(train => {
          const chosen = train.id === selected;
          const total = pathLength(train.path);
          const a = pathPosition(train.path, total), b = pathPosition(train.path, 0);
          const head = pointAt(layout.segments[train.leading === 'A' ? a.segment : b.segment], train.leading === 'A' ? a.at : b.at);
          const tail = pointAt(layout.segments[train.leading === 'A' ? b.segment : a.segment], train.leading === 'A' ? b.at : a.at);
          let offset = 0;
          return <Group key={train.id} interaction="train" onPointerDown={e => {
            if (busy || e.evt.button !== 0) return;
            setMapPoints(null); suppressClick.current = false; setCursor('grabbing');
            e.cancelBubble = true; props.onSelect(train.id); props.onDragStart?.(train.id, toWorld(pointer(), camera));
            gesture.current = { type: 'train', train: train.id, start: pointer(), camera, dragged: false }; props.onGesture?.(true);
          }}>
            <Line points={flat(pathPoints(layout, train.path))} stroke={chosen ? '#5dd9c1' : '#90a4b9'} strokeWidth={10 / camera.scale} opacity={0.3} hitStrokeWidth={22 / camera.scale}/>
            {train.sections.map(section => {
              const path = cutPath(train.path, offset + 0.65, offset + section.length - 0.65);
              const middle = pathPosition(train.path, offset + section.length / 2), p = pointAt(layout.segments[middle.segment], middle.at);
              offset += section.length;
              return <Group key={section.id}>
                <Line points={flat(pathPoints(layout, path))} stroke={chosen ? '#62d6bf' : '#99a9bd'} strokeWidth={Math.max(3.3, 5 / camera.scale)} lineCap="butt"/>
                {camera.scale > 1.4 && <Text x={p.x - 4 / camera.scale} y={p.y - 4 / camera.scale} text={section.id.split('-')[1]} fill="#0d2630" fontStyle="bold" fontSize={9 / camera.scale} listening={false}/>}
              </Group>;
            })}
            <Circle x={head.x} y={head.y} radius={4.5 / camera.scale} fill="#ecfffa" stroke="#2baf96" strokeWidth={1.5 / camera.scale}/>
            <Line points={[tail.x, tail.y - 5 / camera.scale, tail.x, tail.y + 5 / camera.scale]} stroke="#f6be66" strokeWidth={2 / camera.scale}/>
            <Text x={head.x - 10 / camera.scale} y={head.y + 13 / camera.scale} text={`${train.id} · ${train.leading}`} fill={chosen ? '#8ce7d4' : '#b2c0d0'} fontSize={12 / camera.scale} fontStyle="bold"/>
          </Group>;
        })}
        {Object.values(layout.points).map(p => <Group key={p.id} interaction="points"
          onPointerDown={e => { if (e.evt.button === 0) { e.cancelBubble = true; suppressClick.current = false; } }}
          onPointerClick={e => { if (!busy && !suppressClick.current && e.evt.button === 0) { e.cancelBubble = true; props.onPoints(p.id); setMapPoints(p.id); } }}>
          <Circle x={p.at.x} y={p.at.y} radius={6 / camera.scale} fill={selectedPoints === p.id ? '#e6b65d' : '#718799'} stroke="#101b27" strokeWidth={2 / camera.scale} hitStrokeWidth={24 / camera.scale}/>
          <Text x={p.at.x - 13 / camera.scale} y={p.at.y - 30 / camera.scale} text={`${p.id}\n${scenario.points[p.id] === 'normal' ? 'N' : 'R'}`} align="center" fontSize={11 / camera.scale} fill="#e5c182"/>
        </Group>)}
        {marker(props.boundary, '#e6b65d', 'CLEARANCE')}
        {marker(props.proposed, '#a5b7ff', 'CLEAR STOP')}
        {marker(props.preview?.stop, props.preview?.valid ? '#5dd9c1' : '#fb8d7e', 'TARGET')}
      </Layer>
    </Stage>
    {popupPoints && <div className="map-points-controls" role="group" aria-label={`${popupPoints.id} controls`} style={{
      left: Math.max(12, Math.min(size.width - 224, popupPoints.at.x * camera.scale + camera.x + 16)),
      top: Math.max(72, Math.min(size.height - 154, popupPoints.at.y * camera.scale + camera.y + 18)),
    }}>
      <div className="map-points-title"><strong>{popupPoints.id}</strong><span>{scenario.points[popupPoints.id]}</span><button aria-label="Close points controls" onClick={() => setMapPoints(null)}>×</button></div>
      <p className={popupLocks.length ? 'amber-text' : 'mint-text'}>{popupLocks.length ? `Locked by ${popupLocks.join(', ')} · ${layout.margins.points} m margin` : 'Clearance zone free'}</p>
      <button className="full" disabled={busy || gesture.current !== null || popupLocks.length > 0} onClick={() => props.onTogglePoints(popupPoints.id)}>Set {scenario.points[popupPoints.id] === 'normal' ? 'Reverse' : 'Normal'}</button>
    </div>}
    <div className="canvas-bottom"><span>● Leading end <b>│</b> Trailing end <em>━</em> Occupied length</span><span><i style={{ width: 20 * camera.scale }}/>20 m <small>{camera.scale.toFixed(2)} px/m</small></span></div>
  </div>;
}

export type Vec = { x: number; y: number };
export type Position = 'normal' | 'reverse';
export type End = 'a' | 'b';
export interface Segment { id: string; label: string; geometry: Vec[]; gate?: { points: string; position: Position } }
export interface Port { segment: string; end: End }
export interface Link { from: Port; to: Port }
export interface Interval { segment: string; from: number; to: number }
export interface Points { id: string; at: Vec; zone: Interval[] }
export interface Layout {
  segments: Record<string, Segment>; links: Link[]; points: Record<string, Points>;
  buffers: Port[]; margins: { train: number; points: number; buffer: number };
}
// Canonical B -> A path. Directed slices carry all longitudinal placement.
export interface Train { id: string; sections: { id: string; length: number }[]; path: Interval[]; leading: 'A' | 'B' }
export interface Scenario { id: string; trains: Train[]; points: Record<string, Position> }
export interface Destination { segment: string; at: number }

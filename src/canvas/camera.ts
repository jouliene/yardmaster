import type { Vec } from '../domain/types';
export interface Camera { x: number; y: number; scale: number }
export const toWorld = (p: Vec, c: Camera): Vec => ({ x: (p.x - c.x) / c.scale, y: (p.y - c.y) / c.scale });
export const toScreen = (p: Vec, c: Camera): Vec => ({ x: p.x * c.scale + c.x, y: p.y * c.scale + c.y });
export function fit(points: Vec[], width: number, height: number): Camera {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs) - 20, maxX = Math.max(...xs) + 20;
  const minY = Math.min(...ys) - 24, maxY = Math.max(...ys) + 24;
  const scale = Math.max(0.2, Math.min(9, (width - 80) / (maxX - minX), (height - 100) / (maxY - minY)));
  return { scale, x: width / 2 - (minX + maxX) / 2 * scale, y: height / 2 - (minY + maxY) / 2 * scale };
}
export function zoom(camera: Camera, pointer: Vec, factor: number): Camera {
  const world = toWorld(pointer, camera), scale = Math.max(0.4, Math.min(14, camera.scale * factor));
  return { scale, x: pointer.x - world.x * scale, y: pointer.y - world.y * scale };
}

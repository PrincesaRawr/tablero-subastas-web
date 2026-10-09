import { COLUMN_LETTERS, type Color } from '../shared/config.js';
import { emptyBoard, type Board, type Placement } from '../shared/engine.js';

/** RNG determinista para tests. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "rosa A3" → { color: 'rosa', row: 2, col: 0 } */
export function p(spec: string): Placement {
  const [color, cell] = spec.split(' ');
  return { color: color as Color, col: COLUMN_LETTERS.indexOf(cell[0] as never), row: Number(cell.slice(1)) - 1 };
}

export function boardWith(...specs: string[]): Board {
  const b = emptyBoard();
  for (const s of specs) {
    const { color, row, col } = p(s);
    b[row][col] = color;
  }
  return b;
}

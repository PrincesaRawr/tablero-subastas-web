import { COLOR_LABEL, COLUMN_LETTERS, type Color } from '../../../shared/config';
import { cellName, type Board as BoardData, type Cell, type Placement } from '../../../shared/engine';
import { Token } from './Token';

interface BoardProps {
  board: BoardData;
  /** Fichas provisionales (colocación en curso o propuesta de negociación). */
  ghosts?: Placement[];
  ghostKind?: 'draft' | 'proposal';
  /** Fichas provisionales de la otra persona (negociación en tiempo real), en dorado. */
  otherGhosts?: Placement[];
  /** Apariciones a resaltar (cada una, lista ordenada de casillas). */
  highlights?: Cell[][];
  /** Casillas recién colocadas (para animarlas). */
  recent?: Cell[];
  onCellClick?: (cell: Cell) => void;
}

function Flower({ x, y, c = '#ffa6d5' }: { x: string; y: string; c?: string }) {
  return (
    <span className="deco flower" style={{ left: x, top: y, color: c }} aria-hidden="true">
      ✿
    </span>
  );
}
function Star({ x, y, c = '#ffd86b', s = 1 }: { x: string; y: string; c?: string; s?: number }) {
  return (
    <span className="deco star" style={{ left: x, top: y, color: c, fontSize: `${s}em` }} aria-hidden="true">
      ✦
    </span>
  );
}

/** Lazo con gema: arriba lleva corona. */
function Bow({ top }: { top?: boolean }) {
  return (
    <svg className={`bow ${top ? 'bow-top' : 'bow-bottom'}`} viewBox="0 0 120 50" aria-hidden="true">
      {top && <path d="M48 12 L51 2 L56 8 L60 0 L64 8 L69 2 L72 12 Z" fill="#ffd45e" stroke="#c98a12" strokeWidth="1.2" />}
      <path d="M60 28 Q35 6 14 16 Q6 30 18 40 Q38 44 60 28 Z" fill="#a679e8" stroke="#6b3fb8" strokeWidth="2" />
      <path d="M60 28 Q85 6 106 16 Q114 30 102 40 Q82 44 60 28 Z" fill="#a679e8" stroke="#6b3fb8" strokeWidth="2" />
      <path d="M52 30 L40 48 L50 46 L56 32 Z M68 30 L80 48 L70 46 L64 32 Z" fill="#9466dc" stroke="#6b3fb8" strokeWidth="1.5" />
      <path d="M60 17 L68 28 L60 39 L52 28 Z" fill="#c9b6ff" stroke="#6b3fb8" strokeWidth="2" />
      <path d="M60 20 L64 28 L60 28 Z" fill="#fff" opacity="0.8" />
    </svg>
  );
}

function HighlightLayer({ highlights }: { highlights: Cell[][] }) {
  return (
    <svg className="highlights" viewBox="0 0 8 8" aria-hidden="true">
      {highlights.map((occ, i) => {
        const a = occ[0];
        const b = occ[occ.length - 1];
        const x1 = a.col + 0.5, y1 = a.row + 0.5, x2 = b.col + 0.5, y2 = b.row + 0.5;
        const diagonal = a.row !== b.row && a.col !== b.col;
        const len = Math.hypot(x2 - x1, y2 - y1) + (diagonal ? 1.15 : 0.92);
        const h = diagonal ? 0.95 : 0.86;
        const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        const perimeter = 2 * (len + h);
        return (
          <rect
            key={`${i}-${a.row}${a.col}${b.row}${b.col}`}
            className="hl"
            style={{ ['--perim' as string]: perimeter, animationDelay: `${i * 90}ms` }}
            x={-len / 2}
            y={-h / 2}
            width={len}
            height={h}
            rx={0.12}
            transform={`translate(${(x1 + x2) / 2} ${(y1 + y2) / 2}) rotate(${angle})`}
          />
        );
      })}
    </svg>
  );
}

export function Board({ board, ghosts = [], ghostKind = 'draft', otherGhosts = [], highlights = [], recent = [], onCellClick }: BoardProps) {
  const ghostAt = new Map(ghosts.map((g) => [`${g.row},${g.col}`, g.color]));
  const otherAt = new Map(otherGhosts.map((g) => [`${g.row},${g.col}`, g.color]));
  const recentSet = new Set(recent.map((c) => `${c.row},${c.col}`));

  return (
    <div className="board-frame">
      <Bow top />
      <div className="frame-deco" aria-hidden="true">
        <Flower x="3%" y="10%" />
        <Flower x="2%" y="40%" c="#d9b8ff" />
        <Flower x="3%" y="72%" />
        <Flower x="95%" y="22%" c="#d9b8ff" />
        <Flower x="94.5%" y="55%" />
        <Flower x="95%" y="86%" c="#ffc6e4" />
        <Star x="94.5%" y="9%" s={1.3} />
        <Star x="2.5%" y="92%" s={1.3} />
        <Star x="95%" y="73%" c="#f2d9ff" />
        <Star x="2%" y="58%" c="#f2d9ff" s={0.8} />
        <Star x="20%" y="96%" c="#ffd86b" s={0.8} />
        <Star x="78%" y="96%" c="#ffd86b" s={0.8} />
      </div>
      <div className="board-inner">
        <div className="board-grid" role="grid" aria-label="Tablero de 8 por 8">
          <span className="corner" aria-hidden="true">✦</span>
          {COLUMN_LETTERS.map((l) => (
            <span key={l} className="label col-label" aria-hidden="true">
              {l}
            </span>
          ))}
          {board.map((row, r) => (
            <div className="board-row" role="row" key={r}>
              <span className="label row-label" aria-hidden="true">
                {r + 1}
              </span>
              {row.map((color, c) => {
                const key = `${r},${c}`;
                const mineGhost = ghostAt.get(key);
                const otherGhost = otherAt.get(key);
                const ghost = mineGhost ?? otherGhost;
                const kind = mineGhost ? ghostKind : 'proposal';
                const shown: Color | null = color ?? ghost ?? null;
                const name = cellName(r, c);
                const clickable = !!onCellClick && color === null && !otherGhost;
                const label = color
                  ? `${name}: ${COLOR_LABEL[color]}`
                  : ghost
                    ? `${name}: ${COLOR_LABEL[ghost]} (provisional)`
                    : `${name}: vacía`;
                return (
                  <button
                    key={c}
                    type="button"
                    role="gridcell"
                    className={`cell${clickable ? ' clickable' : ''}${ghost && !color ? ` ghost ghost-${kind}` : ''}`}
                    aria-label={label}
                    title={label}
                    disabled={!clickable}
                    tabIndex={clickable ? 0 : -1}
                    onClick={() => clickable && onCellClick!({ row: r, col: c })}
                  >
                    {shown && <Token color={shown} className={recentSet.has(key) || (ghost && !color) ? 'pop' : ''} noSymbol={false} />}
                  </button>
                );
              })}
            </div>
          ))}
          <HighlightLayer highlights={highlights} />
        </div>
      </div>
      <Bow />
    </div>
  );
}

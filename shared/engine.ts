/**
 * Motor del juego: funciones puras, sin red ni estado global.
 * Lo usan el servidor (autoritativo) y el cliente (vistas previas y resaltado).
 */
import {
  BOARD_SIZE,
  COLORS,
  COLOR_LABEL,
  COLUMN_LETTERS,
  COMBO_LENGTH,
  MIN_BID,
  type Color,
} from './config.js';

export type Board = (Color | null)[][]; // board[fila][columna]; fila 0 = "1", columna 0 = "A"
export type Rng = () => number;
export type AuctionId = 'A' | 'B';

export interface Cell {
  row: number;
  col: number;
}
export interface Placement extends Cell {
  color: Color;
}
/** Puja de un jugador en una ronda. 0 = no participa en esa subasta. */
export interface Bid {
  A: number;
  B: number;
}

// ───────────────────────── utilidades ─────────────────────────

export function emptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array<Color | null>(BOARD_SIZE).fill(null));
}

export function cellName(row: number, col: number): string {
  return `${COLUMN_LETTERS[col]}${row + 1}`;
}

/** "Rosa A3, Azul C7, …" */
export function formatPlacements(placements: Placement[]): string {
  return placements.map((p) => `${COLOR_LABEL[p.color]} ${cellName(p.row, p.col)}`).join(', ');
}

export function randomInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function randomTokens(count: number, rng: Rng): Color[] {
  return Array.from({ length: count }, () => COLORS[randomInt(rng, COLORS.length)]);
}

function inBounds(row: number, col: number): boolean {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < BOARD_SIZE && col < BOARD_SIZE;
}

// ───────────────────────── combinaciones (D2) ─────────────────────────

/** Todas las secuencias de COMBO_LENGTH colores distintos. */
export function allCombos(): Color[][] {
  const out: Color[][] = [];
  const build = (prefix: Color[]) => {
    if (prefix.length === COMBO_LENGTH) return void out.push(prefix);
    for (const c of COLORS) if (!prefix.includes(c)) build([...prefix, c]);
  };
  build([]);
  return out;
}

const comboKey = (combo: readonly Color[]) => combo.join('>');

/** Máximo de jugadores que admite D2 (una combinación por par combinación/inversa). */
export const MAX_DISTINCT_COMBOS = allCombos().length / 2;

/**
 * Reparte `n` combinaciones al azar: colores distintos, únicas, y ningún par
 * de jugadores con combinaciones inversas entre sí.
 */
export function assignCombos(n: number, rng: Rng): Color[][] {
  if (n > MAX_DISTINCT_COMBOS) throw new Error(`Como máximo ${MAX_DISTINCT_COMBOS} combinaciones distintas`);
  const taken = new Set<string>();
  const result: Color[][] = [];
  for (const combo of shuffle(allCombos(), rng)) {
    if (result.length === n) break;
    if (taken.has(comboKey(combo))) continue;
    taken.add(comboKey(combo));
    taken.add(comboKey([...combo].reverse()));
    result.push(combo);
  }
  return result;
}

// ───────────────────────── apariciones ─────────────────────────

/** Direcciones: horizontal →, vertical ↓, diagonal ↘, diagonal ↗. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [-1, 1],
];

/**
 * Devuelve cada aparición de la combinación como lista ordenada de casillas
 * (en el orden de la combinación). Se lee en ambos sentidos y las apariciones
 * que comparten casillas cuentan por separado.
 */
export function findOccurrences(board: Board, combo: readonly Color[]): Cell[][] {
  const len = combo.length;
  const found: Cell[][] = [];
  if (len === 0) return found;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      for (const [dr, dc] of DIRECTIONS) {
        const endR = row + dr * (len - 1);
        const endC = col + dc * (len - 1);
        if (!inBounds(endR, endC)) continue;
        const cells = Array.from({ length: len }, (_, i) => ({ row: row + dr * i, col: col + dc * i }));
        const colors = cells.map((c) => board[c.row][c.col]);
        if (colors.every((c, i) => c === combo[i])) found.push(cells);
        else if (colors.every((c, i) => c === combo[len - 1 - i])) found.push([...cells].reverse());
      }
    }
  }
  return found;
}

export function countOccurrences(board: Board, combo: readonly Color[]): number {
  return findOccurrences(board, combo).length;
}

// ───────────────────────── pujas (D3) ─────────────────────────

export function validateBid(coins: number, bid: Bid): string | null {
  for (const id of ['A', 'B'] as const) {
    const v = bid[id];
    if (typeof v !== 'number' || !Number.isInteger(v)) return 'Las pujas tienen que ser números enteros.';
    if (v < 0) return 'Las pujas no pueden ser negativas.';
    if (v > 0 && v < MIN_BID) return `La puja mínima es ${MIN_BID}.`;
  }
  if (bid.A === 0 && bid.B === 0) return null; // retirar la puja siempre es válido
  if (coins <= 0) return 'No te quedan monedas para pujar.';
  if (bid.A + bid.B > coins) return 'Tu puja supera tus monedas disponibles.';
  return null;
}

// ───────────────────────── resolución de la ronda ─────────────────────────

export interface AuctionWinner {
  playerId: string;
  bid: number;
  /** [D4] Otros jugadores que empataron con la puja máxima (desempate aleatorio). */
  tiedWith: string[];
}

export type ResolutionOutcome =
  | 'none' // [D7] nadie pujó
  | 'single' // [D6] solo una subasta tuvo pujas
  | 'normal' // dos ganadores distintos; recibe el que pujó menos
  | 'tie' // dos ganadores distintos con la misma puja → negociación
  | 'same-player' // [D5] el mismo jugador ganó ambas, con pujas distintas
  | 'same-player-choice'; // [D5] el mismo jugador ganó ambas con la misma puja: elige él

export interface Resolution {
  winners: { A: AuctionWinner | null; B: AuctionWinner | null };
  outcome: ResolutionOutcome;
  /** Quién recibe fichas y de qué subasta (null si nadie o si queda pendiente). */
  recipient: { playerId: string; auction: AuctionId } | null;
  /** Monedas que pierde cada jugador. Solo los ganadores pierden su puja ganadora. */
  coinsLost: Record<string, number>;
}

function auctionWinner(bids: Record<string, Bid>, id: AuctionId, rng: Rng): AuctionWinner | null {
  let max = 0;
  let top: string[] = [];
  for (const [playerId, bid] of Object.entries(bids)) {
    const v = bid[id];
    if (v <= 0) continue;
    if (v > max) {
      max = v;
      top = [playerId];
    } else if (v === max) top.push(playerId);
  }
  if (top.length === 0) return null;
  top.sort(); // independiza el resultado del orden de inserción
  const winner = top[randomInt(rng, top.length)];
  return { playerId: winner, bid: max, tiedWith: top.filter((p) => p !== winner) };
}

export function resolveAuctions(bids: Record<string, Bid>, rng: Rng): Resolution {
  const A = auctionWinner(bids, 'A', rng);
  const B = auctionWinner(bids, 'B', rng);
  const winners = { A, B };
  const coinsLost: Record<string, number> = {};
  for (const w of [A, B]) if (w) coinsLost[w.playerId] = (coinsLost[w.playerId] ?? 0) + w.bid;

  if (!A && !B) return { winners, outcome: 'none', recipient: null, coinsLost };
  if (!A || !B) {
    const w = (A ?? B)!;
    return { winners, outcome: 'single', recipient: { playerId: w.playerId, auction: A ? 'A' : 'B' }, coinsLost };
  }
  if (A.playerId === B.playerId) {
    if (A.bid === B.bid) return { winners, outcome: 'same-player-choice', recipient: null, coinsLost };
    return {
      winners,
      outcome: 'same-player',
      recipient: { playerId: A.playerId, auction: A.bid < B.bid ? 'A' : 'B' },
      coinsLost,
    };
  }
  if (A.bid === B.bid) return { winners, outcome: 'tie', recipient: null, coinsLost };
  const auction: AuctionId = A.bid < B.bid ? 'A' : 'B';
  return { winners, outcome: 'normal', recipient: { playerId: winners[auction]!.playerId, auction }, coinsLost };
}

/** Descuenta las monedas perdidas. El resto de pujas simplemente no se cobran. */
export function applyCoinLoss(coins: Record<string, number>, coinsLost: Record<string, number>): Record<string, number> {
  const out = { ...coins };
  for (const [id, lost] of Object.entries(coinsLost)) out[id] = Math.max(0, (out[id] ?? 0) - lost);
  return out;
}

// ───────────────────────── colocación (D8) ─────────────────────────

/** Comprueba que `placements` coloca exactamente `tokens` en casillas libres y distintas. */
export function validatePlacements(board: Board, tokens: readonly Color[], placements: Placement[]): string | null {
  if (!Array.isArray(placements)) return 'Colocación no válida.';
  if (placements.length !== tokens.length) return `Tienes que colocar exactamente ${tokens.length} fichas.`;
  const pending = [...tokens];
  const used = new Set<string>();
  for (const p of placements) {
    if (!p || typeof p !== 'object') return 'Colocación no válida.';
    if (!inBounds(p.row, p.col)) return 'Esa casilla no existe.';
    const idx = pending.indexOf(p.color);
    if (idx === -1) return 'Estás intentando colocar una ficha que no tienes.';
    pending.splice(idx, 1);
    const key = `${p.row},${p.col}`;
    if (used.has(key)) return 'No puedes poner dos fichas en la misma casilla.';
    used.add(key);
    if (board[p.row][p.col] !== null) return `La casilla ${cellName(p.row, p.col)} ya está ocupada.`;
  }
  return null;
}

export function applyPlacements(board: Board, placements: Placement[]): Board {
  const next = board.map((r) => [...r]);
  for (const p of placements) next[p.row][p.col] = p.color;
  return next;
}

export function freeCells(board: Board): Cell[] {
  const cells: Cell[] = [];
  board.forEach((r, row) => r.forEach((c, col) => c === null && cells.push({ row, col })));
  return cells;
}

/** Colocación aleatoria (la puede forzar el anfitrión). */
export function randomPlacements(board: Board, tokens: readonly Color[], rng: Rng): Placement[] {
  const cells = shuffle(freeCells(board), rng);
  return tokens.slice(0, cells.length).map((color, i) => ({ color, ...cells[i] }));
}

// ───────────────────────── final (D10) ─────────────────────────

export interface PlayerResult {
  playerId: string;
  combo: Color[];
  count: number;
  occurrences: Cell[][];
}
export interface FinalResults {
  ranking: PlayerResult[];
  winners: string[];
}

export function computeFinalResults(board: Board, players: { id: string; combo: Color[] }[]): FinalResults {
  const ranking = players
    .map((p) => {
      const occurrences = findOccurrences(board, p.combo);
      return { playerId: p.id, combo: p.combo, count: occurrences.length, occurrences };
    })
    .sort((a, b) => b.count - a.count);
  const best = ranking[0]?.count ?? 0;
  return { ranking, winners: ranking.filter((r) => r.count === best).map((r) => r.playerId) };
}

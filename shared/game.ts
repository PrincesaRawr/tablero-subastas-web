/**
 * Máquina de estados de una partida, como reductor puro:
 *   gameReducer(estado, acción, contexto) → nuevo estado | error
 * El servidor es quien la ejecuta; el cliente solo envía intenciones.
 *
 * FICHAS → PUJAS_ABIERTAS → RESOLUCION → [NEGOCIACION] → COLOCACION → RONDA_CERRADA → … → FIN
 */
import {
  AUTO_CLOSE_AFTER_ALL_BIDS_S,
  MAX_COINS,
  SHARED_TIE_PICK,
  NEGOTIATION_PICK,
  NEGOTIATION_TIME_LIMIT_S,
  STARTING_COINS,
  TOKENS_PER_AUCTION,
  TOTAL_ROUNDS,
  type Color,
} from './config.js';
import {
  applyCoinLoss,
  applyPlacements,
  assignCombos,
  computeFinalResults,
  emptyBoard,
  randomPlacements,
  randomTokens,
  resolveAuctions,
  validateBid,
  validatePlacements,
  type AuctionId,
  type Bid,
  type Board,
  type FinalResults,
  type Placement,
  type Resolution,
  type Rng,
} from './engine.js';

export type Phase =
  | 'FICHAS'
  | 'PUJAS_ABIERTAS'
  | 'RESOLUCION'
  | 'NEGOCIACION'
  | 'COLOCACION'
  | 'RONDA_CERRADA'
  | 'FIN';

export interface GamePlayer {
  id: string;
  combo: Color[];
  coins: number;
}

/**
 * Negociación entre dos personas empatadas:
 *  - split  (ganan A y B con la misma puja): cada uno elige NEGOTIATION_PICK de SUS 5 fichas.
 *  - shared (empatan en la misma subasta): cada uno elige SHARED_TIE_PICK de las 5 comunes, sin repetir.
 * Después cada uno coloca SOLO sus fichas; el otro las ve en tiempo real. Cuando los dos pulsan
 * "Estoy de acuerdo" se aplican al tablero. "Sin acuerdo" o fin del tiempo → ronda nula.
 */
export interface Negotiation {
  players: [string, string];
  /** Las 5 fichas entre las que elige cada negociador. */
  tokens: Record<string, Color[]>;
  /** Índices (en `tokens[jugador]`) de las fichas elegidas; null = aún no ha elegido. */
  picks: Record<string, number[] | null>;
  /** Colocación actual (provisional, puede estar a medias) de cada negociador. */
  live: Record<string, Placement[]>;
  /** Quién ha dado su visto bueno a la colocación actual. */
  agreed: Record<string, boolean>;
  deadline: number;
  shared: boolean;
}

export interface PlacementTask {
  playerId: string;
  auction: AuctionId;
  tokens: Color[];
  deadline: number | null;
}

export type LogEntry =
  | { type: 'resolution'; round: number; resolution: PublicResolution }
  | { type: 'placement'; round: number; playerIds: string[]; placements: Placement[]; random: boolean }
  | { type: 'null-round'; round: number; playerIds: string[]; reason: 'sin-acuerdo' | 'tiempo' }
  /** El anfitrión miró las pujas de la subasta abierta (se avisa a todos). */
  | { type: 'peek'; round: number; by: string }
  /** El anfitrión cambió las monedas de un jugador. */
  | { type: 'coins'; round: number; playerId: string; from: number; to: number }
  /** El anfitrión terminó la partida antes de tiempo. */
  | { type: 'ended'; round: number };

export type PublicResolution = Omit<Resolution, 'coinsLost'>;

export interface GameState {
  phase: Phase;
  round: number;
  totalRounds: number;
  board: Board;
  players: GamePlayer[];
  auction: { A: Color[]; B: Color[] } | null;
  auctionDeadline: number | null;
  /** Cierre automático: todos han enviado su puja y no hay cambios hasta este momento. */
  autoCloseAt: number | null;
  bids: Record<string, Bid>;
  resolution: Resolution | null;
  placement: PlacementTask | null;
  negotiation: Negotiation | null;
  log: LogEntry[];
  results: FinalResults | null;
}

export interface GameSettings {
  auctionTimerS: number;
  placementTimerS: number;
}

export type GameAction =
  | { type: 'deal' }
  | { type: 'open' }
  | { type: 'bid'; bid: Bid }
  | { type: 'close' }
  | { type: 'choose'; auction: AuctionId }
  | { type: 'place'; placements: Placement[] }
  | { type: 'forceRandom' }
  | { type: 'next' }
  | { type: 'peek' }
  | { type: 'setCoins'; playerId: string; coins: number }
  | { type: 'endNow' }
  | { type: 'negPick'; indices: number[] }
  | { type: 'negSet'; placements: Placement[] }
  | { type: 'negAgree' }
  | { type: 'negNoDeal' }
  | { type: 'negExpire' };

export interface ActionContext {
  /** Jugador que ejecuta la acción (null = sistema, p. ej. un temporizador). */
  actorId: string | null;
  isHost: boolean;
  rng: Rng;
  now: number;
  settings: GameSettings;
}

export type ReducerResult = { ok: true; state: GameState } | { ok: false; error: string };

export function createGame(playerIds: string[], rng: Rng): GameState {
  const combos = assignCombos(playerIds.length, rng);
  return {
    phase: 'FICHAS',
    round: 1,
    totalRounds: TOTAL_ROUNDS,
    board: emptyBoard(),
    players: playerIds.map((id, i) => ({ id, combo: combos[i], coins: STARTING_COINS })),
    auction: null,
    auctionDeadline: null,
    autoCloseAt: null,
    bids: {},
    resolution: null,
    placement: null,
    negotiation: null,
    log: [],
    results: null,
  };
}

const fail = (error: string): ReducerResult => ({ ok: false, error });

export function publicResolution(r: Resolution): PublicResolution {
  return { winners: r.winners, outcome: r.outcome, recipient: r.recipient, sharedAuction: r.sharedAuction };
}

export function gameReducer(prev: GameState, action: GameAction, ctx: ActionContext): ReducerResult {
  const s: GameState = structuredClone(prev);
  const isSystem = ctx.actorId === null;
  const canControl = ctx.isHost || isSystem;
  const player = ctx.actorId ? s.players.find((p) => p.id === ctx.actorId) : undefined;
  const ok = (): ReducerResult => ({ ok: true, state: s });

  switch (action.type) {
    case 'deal': {
      if (!canControl) return fail('Solo el anfitrión puede repartir fichas.');
      if (s.phase !== 'FICHAS') return fail('Ahora no se pueden repartir fichas.');
      if (s.auction) return fail('Las fichas de esta ronda ya están repartidas.');
      s.auction = { A: randomTokens(TOKENS_PER_AUCTION, ctx.rng), B: randomTokens(TOKENS_PER_AUCTION, ctx.rng) };
      return ok();
    }

    case 'open': {
      if (!canControl) return fail('Solo el anfitrión puede abrir la subasta.');
      if (s.phase !== 'FICHAS' || !s.auction) return fail('Primero hay que repartir las fichas.');
      s.phase = 'PUJAS_ABIERTAS';
      s.bids = {};
      s.auctionDeadline = ctx.settings.auctionTimerS > 0 ? ctx.now + ctx.settings.auctionTimerS * 1000 : null;
      s.autoCloseAt = null;
      return ok();
    }

    case 'bid': {
      if (!player) return fail('No participas en esta partida.');
      if (s.phase !== 'PUJAS_ABIERTAS') return fail('La subasta no está abierta.');
      const bid = action.bid;
      if (!bid || typeof bid !== 'object') return fail('Puja no válida.');
      const clean: Bid = { A: bid.A, B: bid.B };
      const err = validateBid(player.coins, clean);
      if (err) return fail(err);
      // 0 y 0 = "no pujo esta ronda": cuenta como enviada, pero no participa en ninguna subasta
      s.bids[player.id] = clean;
      // Si ya han enviado todos, empieza (o vuelve a empezar) la cuenta atrás para cerrar sola.
      const everyone = s.players.every((p) => s.bids[p.id]);
      s.autoCloseAt = everyone && AUTO_CLOSE_AFTER_ALL_BIDS_S > 0 ? ctx.now + AUTO_CLOSE_AFTER_ALL_BIDS_S * 1000 : null;
      return ok();
    }

    case 'peek': {
      if (!ctx.isHost || !ctx.actorId) return fail('Solo el anfitrión puede mirar las pujas.');
      if (s.phase !== 'PUJAS_ABIERTAS') return fail('Solo se pueden mirar las pujas con la subasta abierta.');
      s.log.push({ type: 'peek', round: s.round, by: ctx.actorId });
      return ok();
    }

    case 'setCoins': {
      if (!ctx.isHost) return fail('Solo el anfitrión puede cambiar las monedas.');
      if (s.phase === 'FIN') return fail('La partida ya ha terminado.');
      const target = s.players.find((p) => p.id === action.playerId);
      if (!target) return fail('Ese jugador no está en la partida.');
      const coins = action.coins;
      if (typeof coins !== 'number' || !Number.isInteger(coins) || coins < 0 || coins > MAX_COINS)
        return fail(`Las monedas tienen que ser un número entero entre 0 y ${MAX_COINS}.`);
      const bid = s.phase === 'PUJAS_ABIERTAS' ? s.bids[target.id] : undefined;
      if (bid && bid.A + bid.B > coins)
        return fail(`Ese jugador ya ha pujado ${bid.A + bid.B}; no puedes dejarle con menos mientras la subasta esté abierta.`);
      if (coins === target.coins) return ok();
      s.log.push({ type: 'coins', round: s.round, playerId: target.id, from: target.coins, to: coins });
      target.coins = coins;
      return ok();
    }

    case 'endNow': {
      if (!ctx.isHost) return fail('Solo el anfitrión puede terminar la partida.');
      if (s.phase === 'FIN') return fail('La partida ya ha terminado.');
      s.log.push({ type: 'ended', round: s.round });
      s.phase = 'FIN';
      s.results = computeFinalResults(s.board, s.players);
      s.auction = null;
      s.auctionDeadline = null;
      s.autoCloseAt = null;
      s.bids = {};
      s.resolution = null;
      s.placement = null;
      s.negotiation = null;
      return ok();
    }

    case 'close': {
      if (!canControl) return fail('Solo el anfitrión puede cerrar la subasta.');
      if (s.phase !== 'PUJAS_ABIERTAS' || !s.auction) return fail('La subasta no está abierta.');
      const res = resolveAuctions(s.bids, ctx.rng);
      const coins = applyCoinLoss(Object.fromEntries(s.players.map((p) => [p.id, p.coins])), res.coinsLost);
      for (const p of s.players) p.coins = coins[p.id];
      s.resolution = res;
      s.auctionDeadline = null;
      s.autoCloseAt = null;
      s.bids = {};
      s.log.push({ type: 'resolution', round: s.round, resolution: publicResolution(res) });

      switch (res.outcome) {
        case 'none':
          s.phase = 'RONDA_CERRADA';
          break;
        case 'same-player-choice':
          s.phase = 'RESOLUCION'; // el ganador elige subasta
          break;
        case 'tie':
        case 'shared-tie': {
          const shared = res.outcome === 'shared-tie';
          const w = shared ? res.winners[res.sharedAuction!]! : null;
          const [a, b] = w ? [w.playerId, w.coWinner!] : [res.winners.A!.playerId, res.winners.B!.playerId];
          const pool = shared ? s.auction[res.sharedAuction!] : null;
          s.phase = 'NEGOCIACION';
          s.negotiation = {
            players: [a, b],
            tokens: { [a]: pool ?? s.auction.A, [b]: pool ?? s.auction.B },
            picks: { [a]: null, [b]: null },
            live: { [a]: [], [b]: [] },
            agreed: { [a]: false, [b]: false },
            deadline: ctx.now + NEGOTIATION_TIME_LIMIT_S * 1000,
            shared,
          };
          break;
        }
        default:
          startPlacement(s, res.recipient!.playerId, res.recipient!.auction, ctx);
      }
      return ok();
    }

    case 'choose': {
      if (s.phase !== 'RESOLUCION' || !s.resolution || s.resolution.outcome !== 'same-player-choice')
        return fail('No hay ninguna elección pendiente.');
      const winnerId = s.resolution.winners.A!.playerId;
      if (ctx.actorId !== winnerId) return fail('Solo el ganador puede elegir la subasta.');
      if (action.auction !== 'A' && action.auction !== 'B') return fail('Subasta no válida.');
      s.resolution.recipient = { playerId: winnerId, auction: action.auction };
      startPlacement(s, winnerId, action.auction, ctx);
      return ok();
    }

    case 'place': {
      if (s.phase !== 'COLOCACION' || !s.placement) return fail('Ahora no se pueden colocar fichas.');
      if (ctx.actorId !== s.placement.playerId) return fail('No te toca colocar fichas.');
      const err = validatePlacements(s.board, s.placement.tokens, action.placements);
      if (err) return fail(err);
      finishPlacement(s, [s.placement.playerId], cleanPlacements(action.placements), false);
      return ok();
    }

    case 'forceRandom': {
      if (!canControl) return fail('Solo el anfitrión puede forzar la colocación.');
      if (s.phase !== 'COLOCACION' || !s.placement) return fail('No hay ninguna colocación pendiente.');
      finishPlacement(s, [s.placement.playerId], randomPlacements(s.board, s.placement.tokens, ctx.rng), true);
      return ok();
    }

    case 'next': {
      if (!canControl) return fail('Solo el anfitrión puede pasar de ronda.');
      if (s.phase !== 'RONDA_CERRADA') return fail('La ronda todavía no ha terminado.');
      if (s.round >= s.totalRounds) {
        s.phase = 'FIN';
        s.results = computeFinalResults(s.board, s.players);
      } else {
        s.round += 1;
        s.phase = 'FICHAS';
      }
      s.auction = null;
      s.resolution = null;
      s.placement = null;
      s.negotiation = null;
      return ok();
    }

    // ───────────── negociación (empate entre ganadores) ─────────────

    case 'negPick':
    case 'negSet':
    case 'negAgree':
    case 'negNoDeal': {
      const n = s.negotiation;
      if (s.phase !== 'NEGOCIACION' || !n) return fail('No hay ninguna negociación en curso.');
      const me = ctx.actorId;
      if (!me || !n.players.includes(me)) return fail('No participas en esta negociación.');
      const other = n.players[0] === me ? n.players[1] : n.players[0];
      const howMany = n.shared ? SHARED_TIE_PICK : NEGOTIATION_PICK;

      if (action.type === 'negPick') {
        const idx = action.indices;
        if (
          !Array.isArray(idx) ||
          idx.length !== howMany ||
          new Set(idx).size !== howMany ||
          idx.some((i) => !Number.isInteger(i) || i < 0 || i >= n.tokens[me].length)
        )
          return fail(`Elige exactamente ${howMany} fichas distintas.`);
        if (n.shared && idx.some((i) => n.picks[other]?.includes(i))) return fail('Esa ficha ya la ha elegido la otra persona.');
        n.picks[me] = [...idx].sort((a, b) => a - b);
        n.live[me] = []; // cambiar de fichas reinicia mi colocación
        n.agreed = { [me]: false, [other]: false };
        return ok();
      }
      if (action.type === 'negSet') {
        if (!n.picks[me]) return fail('Primero elige tus fichas.');
        const err = validatePartial(s.board, myTokens(n, me), action.placements, n.live[other]);
        if (err) return fail(err);
        n.live[me] = cleanPlacements(action.placements);
        n.agreed = { [me]: false, [other]: false }; // cualquier cambio pide volver a estar de acuerdo
        return ok();
      }
      if (action.type === 'negAgree') {
        const complete = (pl: string) => !!n.picks[pl] && n.live[pl].length === myTokens(n, pl).length;
        if (!complete(me)) return fail('Coloca todas tus fichas antes de dar el visto bueno.');
        if (!complete(other)) return fail('Espera a que la otra persona coloque todas sus fichas.');
        n.agreed[me] = true;
        if (n.agreed[other]) finishPlacement(s, n.players, [...n.live[n.players[0]], ...n.live[n.players[1]]], false);
        return ok();
      }
      // negNoDeal
      nullRound(s, 'sin-acuerdo');
      return ok();
    }

    case 'negExpire': {
      if (!isSystem) return fail('Acción reservada al servidor.');
      const n = s.negotiation;
      if (s.phase !== 'NEGOCIACION' || !n) return fail('No hay ninguna negociación en curso.');
      if (ctx.now < n.deadline) return fail('La negociación aún no ha caducado.');
      nullRound(s, 'tiempo');
      return ok();
    }
  }
  return fail('Acción desconocida.');
}

/** Fichas elegidas por un negociador. */
export function myTokens(n: Negotiation, playerId: string): Color[] {
  return (n.picks[playerId] ?? []).map((i) => n.tokens[playerId][i]);
}

/** Valida una colocación provisional (puede estar incompleta). */
function validatePartial(board: Board, tokens: Color[], placements: Placement[], blocked: Placement[]): string | null {
  if (!Array.isArray(placements) || placements.length > tokens.length) return 'Colocación no válida.';
  const pending = [...tokens];
  const used = new Set(blocked.map((b) => `${b.row},${b.col}`));
  for (const pl of placements) {
    if (!pl || typeof pl !== 'object') return 'Colocación no válida.';
    const inside = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < board.length;
    if (!inside(pl.row) || !inside(pl.col)) return 'Esa casilla no existe.';
    const i = pending.indexOf(pl.color);
    if (i === -1) return 'Estás intentando colocar una ficha que no tienes.';
    pending.splice(i, 1);
    const key = `${pl.row},${pl.col}`;
    if (board[pl.row][pl.col] !== null || used.has(key)) return 'Esa casilla ya está ocupada.';
    used.add(key);
  }
  return null;
}

function cleanPlacements(placements: Placement[]): Placement[] {
  return placements.map((p) => ({ color: p.color, row: p.row, col: p.col }));
}

function startPlacement(s: GameState, playerId: string, auction: AuctionId, ctx: ActionContext) {
  s.phase = 'COLOCACION';
  s.placement = {
    playerId,
    auction,
    tokens: s.auction![auction],
    deadline: ctx.settings.placementTimerS > 0 ? ctx.now + ctx.settings.placementTimerS * 1000 : null,
  };
}

function finishPlacement(s: GameState, playerIds: string[], placements: Placement[], random: boolean) {
  s.board = applyPlacements(s.board, placements);
  s.log.push({ type: 'placement', round: s.round, playerIds, placements, random });
  s.placement = null;
  s.negotiation = null;
  s.phase = 'RONDA_CERRADA';
}

function nullRound(s: GameState, reason: 'sin-acuerdo' | 'tiempo') {
  s.log.push({ type: 'null-round', round: s.round, playerIds: [...s.negotiation!.players], reason });
  s.negotiation = null;
  s.phase = 'RONDA_CERRADA';
}

/**
 * Máquina de estados de una partida, como reductor puro:
 *   gameReducer(estado, acción, contexto) → nuevo estado | error
 * El servidor es quien la ejecuta; el cliente solo envía intenciones.
 *
 * FICHAS → PUJAS_ABIERTAS → RESOLUCION → [NEGOCIACION] → COLOCACION → RONDA_CERRADA → … → FIN
 */
import {
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

export interface Negotiation {
  players: [string, string];
  /** Las 5 fichas de cada negociador (las de la subasta que ganó). */
  tokens: Record<string, Color[]>;
  /** Índices (en `tokens[jugador]`) de las 3 fichas elegidas; null = aún no ha elegido. */
  picks: Record<string, number[] | null>;
  proposal: { by: string; placements: Placement[] } | null;
  /** Último que rechazó una propuesta (solo informativo). */
  rejectedBy: string | null;
  deadline: number;
  /**
   * true = empataron en la misma subasta: cada uno elige SHARED_TIE_PICK de las 5 fichas (sin repetir
   * las del otro) y las coloca él mismo, a la vez, sin propuesta ni aceptación.
   */
  shared: boolean;
  /** Solo en modo compartido: quién ya ha colocado sus fichas. */
  placed: Record<string, boolean>;
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
  | { type: 'ended'; round: number }
  /** Empate en la misma subasta: quien no colocó a tiempo pierde sus fichas. */
  | { type: 'missed'; round: number; playerIds: string[] };

export type PublicResolution = Omit<Resolution, 'coinsLost'>;

export interface GameState {
  phase: Phase;
  round: number;
  totalRounds: number;
  board: Board;
  players: GamePlayer[];
  auction: { A: Color[]; B: Color[] } | null;
  auctionDeadline: number | null;
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
  | { type: 'negPlace'; placements: Placement[] }
  | { type: 'negPropose'; placements: Placement[] }
  | { type: 'negAccept' }
  | { type: 'negReject' }
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
      s.bids = {};
      s.log.push({ type: 'resolution', round: s.round, resolution: publicResolution(res) });

      switch (res.outcome) {
        case 'none':
          s.phase = 'RONDA_CERRADA';
          break;
        case 'same-player-choice':
          s.phase = 'RESOLUCION'; // el ganador elige subasta
          break;
        case 'tie': {
          const a = res.winners.A!.playerId;
          const b = res.winners.B!.playerId;
          s.phase = 'NEGOCIACION';
          s.negotiation = {
            players: [a, b],
            tokens: { [a]: s.auction.A, [b]: s.auction.B },
            picks: { [a]: null, [b]: null },
            proposal: null,
            rejectedBy: null,
            deadline: ctx.now + NEGOTIATION_TIME_LIMIT_S * 1000,
            shared: false,
            placed: {},
          };
          break;
        }
        case 'shared-tie': {
          const w = res.winners[res.sharedAuction!]!;
          const [a, b] = [w.playerId, w.coWinner!];
          const pool = s.auction[res.sharedAuction!];
          s.phase = 'NEGOCIACION';
          s.negotiation = {
            players: [a, b],
            tokens: { [a]: pool, [b]: pool },
            picks: { [a]: null, [b]: null },
            proposal: null,
            rejectedBy: null,
            deadline: ctx.now + NEGOTIATION_TIME_LIMIT_S * 1000,
            shared: true,
            placed: { [a]: false, [b]: false },
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
    case 'negPlace':
    case 'negPropose':
    case 'negAccept':
    case 'negReject':
    case 'negNoDeal': {
      const n = s.negotiation;
      if (s.phase !== 'NEGOCIACION' || !n) return fail('No hay ninguna negociación en curso.');
      const me = ctx.actorId;
      if (!me || !n.players.includes(me)) return fail('No participas en esta negociación.');
      const other = n.players[0] === me ? n.players[1] : n.players[0];

      if (n.shared) {
        // Empate en la misma subasta: cada uno elige sus fichas y las coloca por su cuenta.
        if (n.placed[me]) return fail('Ya has colocado tus fichas.');
        if (action.type === 'negPick') {
          const idx = action.indices;
          if (
            !Array.isArray(idx) ||
            idx.length !== SHARED_TIE_PICK ||
            new Set(idx).size !== SHARED_TIE_PICK ||
            idx.some((i) => !Number.isInteger(i) || i < 0 || i >= n.tokens[me].length)
          )
            return fail(`Elige exactamente ${SHARED_TIE_PICK} fichas distintas.`);
          if (idx.some((i) => n.picks[other]?.includes(i))) return fail('Esa ficha ya la ha elegido la otra persona.');
          n.picks[me] = [...idx].sort((a, b) => a - b);
          return ok();
        }
        if (action.type === 'negPlace') {
          if (!n.picks[me]) return fail('Primero elige tus fichas.');
          const mine = n.picks[me]!.map((i) => n.tokens[me][i]);
          const err = validatePlacements(s.board, mine, action.placements);
          if (err) return fail(err);
          const placements = cleanPlacements(action.placements);
          s.board = applyPlacements(s.board, placements);
          s.log.push({ type: 'placement', round: s.round, playerIds: [me], placements, random: false });
          n.placed[me] = true;
          if (n.players.every((p) => n.placed[p])) closeNegotiation(s);
          return ok();
        }
        return fail('En este empate cada uno coloca sus propias fichas.');
      }

      if (action.type === 'negPlace') return fail('En esta negociación hay que proponer y aceptar.');
      if (action.type === 'negPick') {
        const idx = action.indices;
        if (
          !Array.isArray(idx) ||
          idx.length !== NEGOTIATION_PICK ||
          new Set(idx).size !== NEGOTIATION_PICK ||
          idx.some((i) => !Number.isInteger(i) || i < 0 || i >= n.tokens[me].length)
        )
          return fail(`Elige exactamente ${NEGOTIATION_PICK} fichas distintas.`);
        n.picks[me] = [...idx].sort((a, b) => a - b);
        n.proposal = null; // cambiar la elección invalida la propuesta
        return ok();
      }
      if (action.type === 'negPropose') {
        if (!n.picks[me] || !n.picks[other]) return fail('Los dos tenéis que elegir vuestras fichas antes de proponer.');
        const err = validatePlacements(s.board, negotiationTokens(n), action.placements);
        if (err) return fail(err);
        n.proposal = { by: me, placements: cleanPlacements(action.placements) };
        n.rejectedBy = null;
        return ok();
      }
      if (action.type === 'negAccept') {
        if (!n.proposal) return fail('No hay ninguna propuesta que aceptar.');
        if (n.proposal.by === me) return fail('Tiene que aceptarla la otra persona.');
        finishPlacement(s, n.players, n.proposal.placements, false);
        return ok();
      }
      if (action.type === 'negReject') {
        if (!n.proposal) return fail('No hay ninguna propuesta que rechazar.');
        if (n.proposal.by === me) return fail('No puedes rechazar tu propia propuesta.');
        n.proposal = null;
        n.rejectedBy = me;
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
      if (n.shared && n.players.some((p) => n.placed[p])) {
        // quien ya colocó conserva sus fichas; las del que no llegó a tiempo se descartan
        s.log.push({ type: 'missed', round: s.round, playerIds: n.players.filter((p) => !n.placed[p]) });
        closeNegotiation(s);
        return ok();
      }
      nullRound(s, 'tiempo');
      return ok();
    }
  }
  return fail('Acción desconocida.');
}

/** Las 6 fichas elegidas entre los dos negociadores. */
export function negotiationTokens(n: Negotiation): Color[] {
  if (n.shared) return n.tokens[n.players[0]];
  return n.players.flatMap((p) => (n.picks[p] ?? []).map((i) => n.tokens[p][i]));
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

function closeNegotiation(s: GameState) {
  s.negotiation = null;
  s.phase = 'RONDA_CERRADA';
}

function nullRound(s: GameState, reason: 'sin-acuerdo' | 'tiempo') {
  s.log.push({ type: 'null-round', round: s.round, playerIds: [...s.negotiation!.players], reason });
  s.negotiation = null;
  s.phase = 'RONDA_CERRADA';
}

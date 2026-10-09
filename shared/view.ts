/**
 * Vista filtrada de la partida para UN jugador.
 * Es lo único que el servidor envía a cada cliente: nunca incluye combinaciones
 * ajenas (hasta FIN) ni pujas ajenas (solo las de los ganadores, D12).
 */
import type { Color } from './config.js';
import type { Bid, Board, FinalResults, Placement } from './engine.js';
import type { GameSettings, GameState, LogEntry, Phase, PlacementTask, PublicResolution } from './game.js';
import { publicResolution } from './game.js';

export interface MemberInfo {
  id: string;
  name: string;
  connected: boolean;
  isPlaying: boolean;
}

export interface RoomSnapshot {
  code: string;
  hostId: string;
  members: MemberInfo[];
  settings: GameSettings;
  game: GameState | null;
}

export interface PublicNegotiation {
  players: [string, string];
  tokens: Record<string, Color[]>;
  /** Si cada negociador ya eligió sus fichas. */
  ready: Record<string, boolean>;
  /** Quién ha dado el visto bueno a la colocación actual. */
  agreed: Record<string, boolean>;
  deadline: number;
  /** Empate en la misma subasta (eligen de las mismas 5 fichas, sin repetir). */
  shared: boolean;
  /** Solo para los dos negociadores: */
  picks?: Record<string, number[] | null>;
  live?: Record<string, Placement[]>;
}

export interface ClientView {
  code: string;
  serverNow: number;
  hostId: string;
  settings: GameSettings;
  me: {
    id: string;
    name: string;
    isHost: boolean;
    isPlaying: boolean;
    inGame: boolean;
    combo: Color[] | null;
    coins: number | null;
    bid: Bid | null;
  };
  members: {
    id: string;
    name: string;
    connected: boolean;
    isHost: boolean;
    isPlaying: boolean;
    inGame: boolean;
    coins: number | null;
    hasBid: boolean;
  }[];
  game: null | {
    phase: Phase;
    round: number;
    totalRounds: number;
    board: Board;
    auction: { A: Color[]; B: Color[] } | null;
    auctionDeadline: number | null;
    autoCloseAt: number | null;
    resolution: PublicResolution | null;
    placement: PlacementTask | null;
    negotiation: PublicNegotiation | null;
    log: LogEntry[];
    results: FinalResults | null;
  };
}

export function buildView(room: RoomSnapshot, viewerId: string, now: number): ClientView {
  const g = room.game;
  const meMember = room.members.find((m) => m.id === viewerId);
  if (!meMember) throw new Error('El jugador no pertenece a la sala');
  const mine = g?.players.find((p) => p.id === viewerId);

  let negotiation: PublicNegotiation | null = null;
  if (g?.negotiation) {
    const n = g.negotiation;
    negotiation = {
      players: n.players,
      tokens: n.tokens,
      ready: Object.fromEntries(n.players.map((p) => [p, n.picks[p] !== null])),
      agreed: { ...n.agreed },
      deadline: n.deadline,
      shared: n.shared,
    };
    if (n.players.includes(viewerId)) {
      negotiation.picks = { ...n.picks };
      negotiation.live = { ...n.live };
    }
  }

  return {
    code: room.code,
    serverNow: now,
    hostId: room.hostId,
    settings: room.settings,
    me: {
      id: meMember.id,
      name: meMember.name,
      isHost: meMember.id === room.hostId,
      isPlaying: meMember.isPlaying,
      inGame: !!mine,
      combo: mine ? [...mine.combo] : null,
      coins: mine?.coins ?? null,
      bid: mine && g?.phase === 'PUJAS_ABIERTAS' ? (g.bids[viewerId] ?? null) : null,
    },
    members: room.members.map((m) => {
      const gp = g?.players.find((p) => p.id === m.id);
      return {
        id: m.id,
        name: m.name,
        connected: m.connected,
        isHost: m.id === room.hostId,
        isPlaying: m.isPlaying,
        inGame: !!gp,
        coins: gp?.coins ?? null,
        hasBid: !!gp && g?.phase === 'PUJAS_ABIERTAS' && !!g.bids[m.id],
      };
    }),
    game: g && {
      phase: g.phase,
      round: g.round,
      totalRounds: g.totalRounds,
      board: g.board,
      auction: g.auction,
      auctionDeadline: g.auctionDeadline,
      autoCloseAt: g.autoCloseAt,
      resolution: g.resolution ? publicResolution(g.resolution) : null,
      placement: g.placement,
      negotiation,
      log: g.log,
      results: g.phase === 'FIN' ? g.results : null,
    },
  };
}

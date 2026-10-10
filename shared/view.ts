/**
 * Vista filtrada de la partida para UN jugador.
 * Es lo único que el servidor envía a cada cliente: nunca incluye combinaciones
 * ajenas (hasta FIN) ni pujas ajenas (solo las de los ganadores, D12).
 */
import type { Color } from './config.js';
import type { Bag, Bid, Board, FinalResults, NegotiationSlot, Placement } from './engine.js';
import type { GameSettings, GameState, LogEntry, Phase, PlacementTask, PublicResolution } from './game.js';
import { publicResolution } from './game.js';

export interface MemberInfo {
  id: string;
  name: string;
  connected: boolean;
  isPlaying: boolean;
}

/** Mensaje de chat. `to` = null → chat general; si no, mensaje privado a esa persona. */
export interface ChatMessage {
  id: number;
  from: string;
  to: string | null;
  text: string;
  at: number;
}

export interface RoomSnapshot {
  code: string;
  hostId: string;
  members: MemberInfo[];
  settings: GameSettings;
  game: GameState | null;
  chat?: ChatMessage[];
}

export interface PublicNegotiation {
  players: string[];
  slots: NegotiationSlot[];
  pools: { A: Color[] | null; B: Color[] | null };
  /** Si cada persona ya eligió todas sus fichas. */
  ready: Record<string, boolean>;
  /** Quién ha dado el visto bueno a la colocación actual. */
  agreed: Record<string, boolean>;
  deadline: number;
  /** Solo para quienes negocian: */
  picks?: (number[] | null)[];
  live?: Record<string, Placement[]>;
}

export interface ClientView {
  code: string;
  serverNow: number;
  hostId: string;
  settings: GameSettings;
  /** Mensajes generales + privados en los que participa este jugador (nunca los privados ajenos). */
  chat: ChatMessage[];
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
    /** Fichas que quedan en el saco de cada subasta (información pública). */
    bags: { A: Bag; B: Bag };
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
      slots: n.slots,
      pools: n.pools,
      ready: Object.fromEntries(n.players.map((p) => [p, n.slots.every((sl, j) => sl.playerId !== p || !!n.picks[j])])),
      agreed: { ...n.agreed },
      deadline: n.deadline,
    };
    if (n.players.includes(viewerId)) {
      negotiation.picks = [...n.picks];
      negotiation.live = { ...n.live };
    }
  }

  return {
    code: room.code,
    serverNow: now,
    hostId: room.hostId,
    settings: room.settings,
    chat: (room.chat ?? []).filter((c) => c.to === null || c.from === viewerId || c.to === viewerId),
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
      bags: g.bags,
    },
  };
}

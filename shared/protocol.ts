/**
 * Mensajes Socket.IO entre cliente y servidor.
 * Todas las peticiones del cliente usan acuse (ack) con Ack<T>.
 * El servidor empuja la vista filtrada con el evento 'state'.
 */
import type { Bid } from './engine.js';
import type { GameAction, GameSettings } from './game.js';
import type { ClientView } from './view.js';

export interface PeekedBid {
  playerId: string;
  /** null = todavía no ha enviado nada. */
  bid: Bid | null;
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

/** Acciones de partida que un cliente puede enviar (negExpire es solo del servidor). */
export type ClientGameAction = Exclude<GameAction, { type: 'negExpire' }>;

export interface ClientToServer {
  'room:create': (p: { name: string; playing: boolean }, ack: Ack<{ token: string; code: string }>) => void;
  'room:join': (p: { code: string; name: string }, ack: Ack<{ token: string; code: string }>) => void;
  'room:resume': (p: { token: string }, ack: Ack<{ code: string }>) => void;
  'room:leave': (p: object, ack: Ack) => void;
  'room:kick': (p: { memberId: string }, ack: Ack) => void;
  'room:setPlaying': (p: { playing: boolean }, ack: Ack) => void;
  'room:settings': (p: GameSettings, ack: Ack) => void;
  'room:close': (p: object, ack: Ack) => void;
  'game:start': (p: object, ack: Ack) => void;
  'game:restart': (p: object, ack: Ack) => void;
  /** Para `peek`, la respuesta incluye las pujas actuales (solo al anfitrión). */
  'game:action': (p: ClientGameAction, ack: Ack<{ bids?: PeekedBid[] }>) => void;
}

export interface ServerToClient {
  state: (view: ClientView) => void;
  kicked: () => void;
  'room:closed': () => void;
}

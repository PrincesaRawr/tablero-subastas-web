import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import {
  DEFAULT_AUCTION_TIMER_S,
  DEFAULT_PLACEMENT_TIMER_S,
  EMPTY_ROOM_TTL_MS,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MAX_TIMER_S,
  MIN_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '../shared/config.js';
import type { Rng } from '../shared/engine.js';
import { createGame, gameReducer, type GameAction, type GameSettings, type GameState } from '../shared/game.js';
import type { ClientToServer, ServerToClient } from '../shared/protocol.js';
import { buildView } from '../shared/view.js';

interface Member {
  id: string;
  token: string;
  name: string;
  isPlaying: boolean;
  sockets: Set<string>;
}

interface Room {
  code: string;
  hostId: string;
  members: Member[];
  settings: GameSettings;
  game: GameState | null;
  timer: NodeJS.Timeout | null;
  emptySince: number | null;
}

type IO = Server<ClientToServer, ServerToClient>;
type ClientSocket = Socket<ClientToServer, ServerToClient, object, { code?: string; memberId?: string }>;

export interface ServerOptions {
  port?: number;
  rng?: Rng;
  now?: () => number;
  staticDir?: string;
}

export interface RunningServer {
  http: HttpServer;
  io: IO;
  port: number;
  close: () => Promise<void>;
  /** Solo para tests: acceso de lectura a las salas. */
  rooms: Map<string, Room>;
}

const CLIENT_ACTIONS = new Set<GameAction['type']>([
  'deal', 'open', 'bid', 'close', 'choose', 'place', 'forceRandom', 'next',
  'negPick', 'negSet', 'negAgree', 'negNoDeal',
  'peek', 'setCoins', 'endNow',
]);

class UserError extends Error {}

export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const rng = opts.rng ?? Math.random;
  const now = opts.now ?? Date.now;
  const rooms = new Map<string, Room>();
  const tokens = new Map<string, { code: string; memberId: string }>();

  const app = express();
  app.get('/health', (_req, res) => void res.json({ ok: true, rooms: rooms.size }));
  const staticDir = opts.staticDir;
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  const http = createHttpServer(app);
  const io: IO = new Server(http, { cors: { origin: '*' } });

  // ───────────── utilidades ─────────────

  const newCode = () => {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomBytes(1)[0] % ROOM_CODE_ALPHABET.length];
      if (!rooms.has(code)) return code;
    }
  };
  const newId = () => randomBytes(6).toString('hex');

  const cleanName = (raw: unknown) => {
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
    if (!name) throw new UserError('Escribe tu nombre.');
    return name;
  };

  const broadcast = (room: Room) => {
    const snapshot = {
      code: room.code,
      hostId: room.hostId,
      settings: room.settings,
      game: room.game,
      members: room.members.map((m) => ({ id: m.id, name: m.name, connected: m.sockets.size > 0, isPlaying: m.isPlaying })),
    };
    const t = now();
    for (const m of room.members) {
      if (m.sockets.size) io.to(`m:${m.id}`).emit('state', buildView(snapshot, m.id, t));
    }
  };

  /** Programa el siguiente evento automático (fin de subasta, de negociación o de colocación). */
  const syncTimer = (room: Room) => {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    const g = room.game;
    if (!g) return;
    let at: number | null = null;
    let action: GameAction | null = null;
    if (g.phase === 'PUJAS_ABIERTAS' && (g.auctionDeadline || g.autoCloseAt)) {
      const times = [g.auctionDeadline, g.autoCloseAt].filter((t): t is number => t !== null);
      [at, action] = [Math.min(...times), { type: 'close' }];
    }
    else if (g.phase === 'NEGOCIACION' && g.negotiation) [at, action] = [g.negotiation.deadline, { type: 'negExpire' }];
    else if (g.phase === 'COLOCACION' && g.placement?.deadline) [at, action] = [g.placement.deadline, { type: 'forceRandom' }];
    if (at === null || !action) return;
    const fire = action;
    room.timer = setTimeout(() => {
      room.timer = null;
      if (!rooms.has(room.code) || !room.game) return;
      const res = gameReducer(room.game, fire, { actorId: null, isHost: false, rng, now: Math.max(now(), at!), settings: room.settings });
      if (res.ok) room.game = res.state;
      syncTimer(room);
      broadcast(room);
    }, Math.max(0, at - now()));
  };

  const closeRoom = (room: Room) => {
    if (room.timer) clearTimeout(room.timer);
    for (const m of room.members) tokens.delete(m.token);
    io.to(`r:${room.code}`).emit('room:closed');
    io.in(`r:${room.code}`).socketsLeave([`r:${room.code}`, ...room.members.map((m) => `m:${m.id}`)]);
    rooms.delete(room.code);
  };

  const attach = (socket: ClientSocket, room: Room, member: Member) => {
    detach(socket);
    socket.data.code = room.code;
    socket.data.memberId = member.id;
    member.sockets.add(socket.id);
    room.emptySince = null;
    socket.join([`r:${room.code}`, `m:${member.id}`]);
  };

  const detach = (socket: ClientSocket) => {
    const { code, memberId } = socket.data;
    if (!code || !memberId) return;
    const room = rooms.get(code);
    socket.leave(`r:${code}`);
    socket.leave(`m:${memberId}`);
    socket.data.code = undefined;
    socket.data.memberId = undefined;
    if (!room) return;
    const m = room.members.find((x) => x.id === memberId);
    m?.sockets.delete(socket.id);
    if (room.members.every((x) => x.sockets.size === 0)) room.emptySince = now();
    broadcast(room);
  };

  const ctxOf = (socket: ClientSocket) => {
    const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
    const member = room?.members.find((m) => m.id === socket.data.memberId);
    if (!room || !member) throw new UserError('No estás en ninguna sala.');
    return { room, member, isHost: member.id === room.hostId };
  };

  const requireHost = (isHost: boolean) => {
    if (!isHost) throw new UserError('Solo el anfitrión puede hacer eso.');
  };

  const startGame = (room: Room) => {
    const players = room.members.filter((m) => m.isPlaying);
    if (players.length < MIN_PLAYERS) throw new UserError(`Hacen falta al menos ${MIN_PLAYERS} jugadores.`);
    if (players.length > MAX_PLAYERS) throw new UserError(`Como máximo pueden jugar ${MAX_PLAYERS} personas.`);
    room.game = createGame(players.map((m) => m.id), rng);
  };

  /** Envuelve un manejador: captura errores y responde por el ack. */
  const handle =
    <P,>(socket: ClientSocket, fn: (p: P) => object | void) =>
    (payload: P, ack?: (r: any) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        reply({ ok: true, ...(fn(payload ?? ({} as P)) ?? {}) });
      } catch (e) {
        if (!(e instanceof UserError)) console.error(e);
        reply({ ok: false, error: e instanceof UserError ? e.message : 'Error inesperado del servidor.' });
      }
    };

  // ───────────── conexión ─────────────

  io.on('connection', (socket: ClientSocket) => {
    socket.on('room:create', handle(socket, (p: { name: string; playing: boolean }) => {
      const name = cleanName(p.name);
      const room: Room = {
        code: newCode(),
        hostId: newId(),
        members: [],
        settings: { auctionTimerS: DEFAULT_AUCTION_TIMER_S, placementTimerS: DEFAULT_PLACEMENT_TIMER_S },
        game: null,
        timer: null,
        emptySince: null,
      };
      const member: Member = { id: room.hostId, token: randomUUID(), name, isPlaying: p.playing !== false, sockets: new Set() };
      room.members.push(member);
      rooms.set(room.code, room);
      tokens.set(member.token, { code: room.code, memberId: member.id });
      attach(socket, room, member);
      broadcast(room);
      return { token: member.token, code: room.code };
    }));

    socket.on('room:join', handle(socket, (p: { code: string; name: string }) => {
      const code = String(p.code ?? '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) throw new UserError('No existe ninguna sala con ese código.');
      const name = cleanName(p.name);
      if (room.game) throw new UserError('La partida de esta sala ya ha empezado.');
      if (room.members.filter((m) => m.isPlaying).length >= MAX_PLAYERS) throw new UserError('La sala está llena.');
      if (room.members.some((m) => m.name.toLowerCase() === name.toLowerCase()))
        throw new UserError('Ya hay alguien con ese nombre en la sala.');
      const member: Member = { id: newId(), token: randomUUID(), name, isPlaying: true, sockets: new Set() };
      room.members.push(member);
      tokens.set(member.token, { code, memberId: member.id });
      attach(socket, room, member);
      broadcast(room);
      return { token: member.token, code };
    }));

    socket.on('room:resume', handle(socket, (p: { token: string }) => {
      const ref = tokens.get(String(p.token ?? ''));
      const room = ref && rooms.get(ref.code);
      const member = room?.members.find((m) => m.id === ref!.memberId);
      if (!room || !member) throw new UserError('Tu sesión anterior ya no existe.');
      attach(socket, room, member);
      broadcast(room);
      return { code: room.code };
    }));

    socket.on('room:leave', handle(socket, () => {
      const { room, member, isHost } = ctxOf(socket);
      if (isHost) throw new UserError('El anfitrión no puede salir: cierra la sala.');
      if (room.game) throw new UserError('No puedes abandonar una partida en curso.');
      detach(socket);
      room.members = room.members.filter((m) => m.id !== member.id);
      tokens.delete(member.token);
      io.in(`m:${member.id}`).socketsLeave([`r:${room.code}`, `m:${member.id}`]);
      broadcast(room);
    }));

    socket.on('room:kick', handle(socket, (p: { memberId: string }) => {
      const { room, isHost } = ctxOf(socket);
      requireHost(isHost);
      if (room.game) throw new UserError('Solo se puede expulsar desde la sala de espera.');
      const target = room.members.find((m) => m.id === p.memberId);
      if (!target || target.id === room.hostId) throw new UserError('No se puede expulsar a esa persona.');
      room.members = room.members.filter((m) => m.id !== target.id);
      tokens.delete(target.token);
      io.to(`m:${target.id}`).emit('kicked');
      io.in(`m:${target.id}`).socketsLeave([`r:${room.code}`, `m:${target.id}`]);
      broadcast(room);
    }));

    socket.on('room:setPlaying', handle(socket, (p: { playing: boolean }) => {
      const { room, member, isHost } = ctxOf(socket);
      requireHost(isHost);
      if (room.game) throw new UserError('No se puede cambiar con la partida empezada.');
      member.isPlaying = !!p.playing;
      broadcast(room);
    }));

    socket.on('room:settings', handle(socket, (p: GameSettings) => {
      const { room, isHost } = ctxOf(socket);
      requireHost(isHost);
      const clamp = (v: unknown) => {
        const n = Math.round(Number(v));
        if (!Number.isFinite(n) || n < 0 || n > MAX_TIMER_S) throw new UserError(`Los temporizadores van de 0 a ${MAX_TIMER_S} s.`);
        return n;
      };
      room.settings = { auctionTimerS: clamp(p.auctionTimerS), placementTimerS: clamp(p.placementTimerS) };
      broadcast(room);
    }));

    socket.on('room:close', handle(socket, () => {
      const { room, isHost } = ctxOf(socket);
      requireHost(isHost);
      closeRoom(room);
    }));

    socket.on('game:start', handle(socket, () => {
      const { room, isHost } = ctxOf(socket);
      requireHost(isHost);
      if (room.game) throw new UserError('La partida ya ha empezado.');
      startGame(room);
      syncTimer(room);
      broadcast(room);
    }));

    socket.on('game:restart', handle(socket, () => {
      const { room, isHost } = ctxOf(socket);
      requireHost(isHost);
      if (room.game?.phase !== 'FIN') throw new UserError('Solo se puede empezar otra partida al terminar esta.');
      startGame(room);
      syncTimer(room);
      broadcast(room);
    }));

    socket.on('game:action', handle(socket, (action: GameAction) => {
      const { room, member, isHost } = ctxOf(socket);
      if (!room.game) throw new UserError('La partida no ha empezado.');
      if (!action || !CLIENT_ACTIONS.has(action.type)) throw new UserError('Acción no válida.');
      const res = gameReducer(room.game, action, { actorId: member.id, isHost, rng, now: now(), settings: room.settings });
      if (!res.ok) throw new UserError(res.error);
      room.game = res.state;
      syncTimer(room);
      broadcast(room);
      // Las pujas solo viajan en la respuesta al anfitrión que las ha pedido, nunca en la vista común.
      if (action.type === 'peek') {
        const g = room.game;
        return { bids: g.players.map((p) => ({ playerId: p.id, bid: g.bids[p.id] ?? null })) };
      }
    }));

    socket.on('disconnect', () => detach(socket));
  });

  // Limpieza de salas abandonadas.
  const sweeper = setInterval(() => {
    for (const room of rooms.values()) {
      if (room.emptySince !== null && now() - room.emptySince > EMPTY_ROOM_TTL_MS) closeRoom(room);
    }
  }, 60_000);
  sweeper.unref();

  await new Promise<void>((resolve) => http.listen(opts.port ?? 0, resolve));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? 0);

  return {
    http,
    io,
    port,
    rooms,
    close: async () => {
      clearInterval(sweeper);
      for (const room of rooms.values()) if (room.timer) clearTimeout(room.timer);
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}

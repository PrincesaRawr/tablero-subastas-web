import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { startServer, type RunningServer } from '../server/app.js';
import { COLORS, TOTAL_ROUNDS, type Color } from '../shared/config.js';
import { freeCells, type Placement } from '../shared/engine.js';
import type { ClientToServer, ServerToClient } from '../shared/protocol.js';
import type { ClientView } from '../shared/view.js';
import { seeded } from './helpers.js';

type ClientSocket = Socket<ServerToClient, ClientToServer>;

interface TestClient {
  socket: ClientSocket;
  views: ClientView[];
  view: () => ClientView;
  call: (event: keyof ClientToServer, payload?: object) => Promise<any>;
  waitFor: (pred: (v: ClientView) => boolean) => Promise<ClientView>;
}

let server: RunningServer;
const url = () => `http://localhost:${server.port}`;

function client(): Promise<TestClient> {
  const socket: ClientSocket = connect(url(), { transports: ['websocket'], forceNew: true });
  const views: ClientView[] = [];
  const waiters: { pred: (v: ClientView) => boolean; resolve: (v: ClientView) => void }[] = [];
  socket.on('state', (v) => {
    views.push(v);
    for (const w of [...waiters]) if (w.pred(v)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(v));
  });
  const c: TestClient = {
    socket,
    views,
    view: () => views[views.length - 1],
    call: async (event, payload = {}) => {
      const res = await (socket as any).timeout(3000).emitWithAck(event, payload);
      return res;
    },
    waitFor: (pred) =>
      new Promise((resolve, reject) => {
        const last = views[views.length - 1];
        if (last && pred(last)) return resolve(last);
        const t = setTimeout(() => reject(new Error('timeout esperando estado')), 3000);
        waiters.push({ pred, resolve: (v) => (clearTimeout(t), resolve(v)) });
      }),
  };
  return new Promise((resolve) => socket.on('connect', () => resolve(c)));
}

async function ok(c: TestClient, event: keyof ClientToServer, payload?: object) {
  const res = await c.call(event, payload);
  if (!res.ok) throw new Error(`${event}: ${res.error}`);
  return res;
}

/** Espera a que todos los clientes hayan recibido el último estado. */
async function settle(clients: TestClient[], pred: (v: ClientView) => boolean) {
  await Promise.all(clients.map((c) => c.waitFor(pred)));
}

function firstFree(v: ClientView, tokens: Color[]): Placement[] {
  const cells = freeCells(v.game!.board);
  return tokens.map((color, i) => ({ color, ...cells[i] }));
}

/** Recorre el objeto y devuelve todas las rutas cuyo nombre de clave cumple `pred`. */
function pathsWithKey(obj: unknown, pred: (k: string) => boolean, path = ''): string[] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).flatMap(([k, v]) => [
    ...(pred(k) ? [`${path}${k}`] : []),
    ...pathsWithKey(v, pred, `${path}${k}.`),
  ]);
}
/** Todos los arrays de exactamente 3 colores que aparezcan en el objeto. */
function colorTriples(obj: unknown): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const here =
    Array.isArray(obj) && obj.length === 3 && obj.every((x) => COLORS.includes(x as Color)) ? [obj.join('>')] : [];
  return [...here, ...Object.values(obj).flatMap(colorTriples)];
}

beforeAll(async () => {
  server = await startServer({ port: 0, rng: seeded(42) });
});
afterAll(async () => {
  await server?.close();
});

describe('partida completa con 3 clientes Socket.IO', () => {
  it('se juega entera sin filtrar información oculta', async () => {
    const host = await client();
    const { code, token: hostToken } = await ok(host, 'room:create', { name: 'Ana', playing: true });
    expect(code).toMatch(/^[A-Z]{4}$/);
    expect(hostToken).toBeTruthy();

    const luis = await client();
    const eva = await client();
    expect((await luis.call('room:join', { code: 'ZZZZ', name: 'Luis' })).error).toBe('No existe ninguna sala con ese código.');
    await ok(luis, 'room:join', { code: code.toLowerCase(), name: 'Luis' });
    expect((await eva.call('room:join', { code, name: 'luis' })).error).toMatch(/ese nombre/);
    const { token: evaToken } = await ok(eva, 'room:join', { code, name: 'Eva' });
    const all = [host, luis, eva];
    await settle(all, (v) => v.members.length === 3);

    // Un jugador no puede empezar la partida
    expect((await luis.call('game:start')).error).toBe('Solo el anfitrión puede hacer eso.');
    await ok(host, 'game:start');
    await settle(all, (v) => v.game?.phase === 'FICHAS');

    const ids = Object.fromEntries(all.map((c) => [c.view().me.name, c.view().me.id]));
    const combos = Object.fromEntries(all.map((c) => [c.view().me.id, c.view().me.combo!]));
    for (const c of all) expect(c.view().me.combo).toHaveLength(3);

    let evaClient = eva;
    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
      const clients = [host, luis, evaClient];
      await ok(host, 'game:action', { type: 'deal' });
      await ok(host, 'game:action', { type: 'open' });
      await settle(clients, (v) => v.game?.phase === 'PUJAS_ABIERTAS' && v.game.round === round);

      if (round === 3) {
        // Ronda de empate entre ganadores → negociación por sockets
        await ok(host, 'game:action', { type: 'bid', bid: { A: 2, B: 0 } });
        await ok(luis, 'game:action', { type: 'bid', bid: { A: 0, B: 2 } });
        await ok(evaClient, 'game:action', { type: 'bid', bid: { A: 1, B: 1 } });
        await ok(host, 'game:action', { type: 'close' });
        await settle(clients, (v) => v.game?.phase === 'NEGOCIACION');
        // los no negociadores no ven ni la elección ni la propuesta
        expect(evaClient.view().game!.negotiation!.picks).toBeUndefined();
        expect(evaClient.view().game!.negotiation!.live).toBeUndefined();
        await ok(host, 'game:action', { type: 'negPick', indices: [0, 1, 2] });
        await ok(luis, 'game:action', { type: 'negPick', indices: [2, 3, 4] });
        const n = (await luis.waitFor((v) => !!v.game?.negotiation?.ready[ids.Ana])).game!.negotiation!;
        const mine = (id: string) => n.picks![id]!.map((i) => n.tokens[id][i]);
        const cells = freeCells(luis.view().game!.board);
        await ok(host, 'game:action', { type: 'negSet', placements: mine(ids.Ana).map((color, i) => ({ color, ...cells[i] })) });
        // Luis ve en tiempo real lo que va colocando Ana
        await luis.waitFor((v) => v.game!.negotiation!.live![ids.Ana].length === 3);
        await ok(luis, 'game:action', { type: 'negSet', placements: mine(ids.Luis).map((color, i) => ({ color, ...cells[i + 3] })) });
        await ok(host, 'game:action', { type: 'negAgree' });
        await ok(luis, 'game:action', { type: 'negAgree' });
      } else if (round === 5) {
        // Eva puja y recarga la página: recupera su sitio con el token
        await ok(host, 'game:action', { type: 'bid', bid: { A: 1, B: 0 } });
        await ok(evaClient, 'game:action', { type: 'bid', bid: { A: 0, B: 3 } });
        await evaClient.waitFor((v) => v.me.bid?.B === 3);
        evaClient.socket.disconnect();
        await host.waitFor((v) => v.members.some((m) => m.name === 'Eva' && !m.connected));
        evaClient = await client();
        expect((await evaClient.call('room:resume', { token: 'falso' })).ok).toBe(false);
        await ok(evaClient, 'room:resume', { token: evaToken });
        const v = await evaClient.waitFor((x) => !!x.game);
        expect(v.me.name).toBe('Eva');
        expect(v.me.combo).toEqual(combos[ids.Eva]);
        expect(v.me.bid).toEqual({ A: 0, B: 3 });
        all.push(evaClient);
        await ok(host, 'game:action', { type: 'close' });
        // A: Ana 1, B: Eva 3 → coloca Ana
        const placing = await host.waitFor((x) => x.game?.phase === 'COLOCACION');
        expect(placing.game!.placement!.playerId).toBe(ids.Ana);
        await ok(host, 'game:action', { type: 'place', placements: firstFree(placing, placing.game!.placement!.tokens) });
      } else {
        // Ana gana A con 1, Luis gana B con 2 → coloca Ana; Eva puja poco y recupera
        await ok(host, 'game:action', { type: 'bid', bid: { A: 1, B: 0 } });
        await ok(luis, 'game:action', { type: 'bid', bid: { A: 0, B: 2 } });
        const tooMuch = await evaClient.call('game:action', { type: 'bid', bid: { A: 30, B: 30 } });
        expect(tooMuch.error).toBe('Tu puja supera tus monedas disponibles.');
        await ok(evaClient, 'game:action', { type: 'bid', bid: { A: 0, B: 1 } });
        await settle(clients, (v) => v.members.filter((m) => m.hasBid).length === 3);
        if (round === 1) {
          // El anfitrión mira las pujas: le llegan solo a él (en la respuesta) y todos ven el aviso
          expect((await luis.call('game:action', { type: 'peek' })).error).toBe('Solo el anfitrión puede mirar las pujas.');
          const peek = await ok(host, 'game:action', { type: 'peek' });
          expect(Object.fromEntries(peek.bids.map((b: any) => [b.playerId, b.bid]))).toEqual({
            [ids.Ana]: { A: 1, B: 0 },
            [ids.Luis]: { A: 0, B: 2 },
            [ids.Eva]: { A: 0, B: 1 },
          });
          await settle(clients, (v) => v.game!.log.some((e) => e.type === 'peek' && e.by === ids.Ana));
        }
        // Luis intenta cerrar: no es anfitrión
        expect((await luis.call('game:action', { type: 'close' })).ok).toBe(false);
        await ok(host, 'game:action', { type: 'close' });
        const placing = await host.waitFor((x) => x.game?.phase === 'COLOCACION');
        expect(placing.game!.placement!.playerId).toBe(ids.Ana);
        expect(placing.game!.resolution!.winners.B).toMatchObject({ playerId: ids.Luis, bid: 2 });
        expect((await luis.call('game:action', { type: 'place', placements: [] })).error).toBe('No te toca colocar fichas.');
        await ok(host, 'game:action', { type: 'place', placements: firstFree(placing, placing.game!.placement!.tokens) });
      }
      await settle([host, luis, evaClient], (v) => v.game?.phase === 'RONDA_CERRADA');
      await ok(host, 'game:action', { type: 'next' });
    }

    const clients = [host, luis, evaClient];
    await settle(clients, (v) => v.game?.phase === 'FIN');
    const final = host.view().game!;
    expect(final.results!.ranking).toHaveLength(3);
    expect(Object.fromEntries(final.results!.ranking.map((r) => [r.playerId, r.combo]))).toEqual(combos);
    expect(final.board.flat().filter(Boolean)).toHaveLength(9 * 5 + 6);
    // Monedas: Ana pierde 1 por ronda (2 en la de empate); Luis 2 por ronda salvo la 5; Eva 0 salvo la 5 (ganó B con 3)
    const coins = Object.fromEntries(host.view().members.map((m) => [m.name, m.coins]));
    expect(coins).toEqual({ Ana: 40 - 9 - 2, Luis: 40 - 2 * 9, Eva: 40 - 3 });

    // ─── Comprobación de fugas en TODOS los mensajes recibidos ───
    for (const c of all) {
      for (const v of c.views) {
        const mine = v.me.combo ? [v.me.combo.join('>')] : [];
        if (v.game?.phase !== 'FIN') {
          // Ninguna combinación ajena (ni como array suelto ni como campo)
          for (const triple of colorTriples(v)) expect(mine).toContain(triple);
          expect(pathsWithKey(v, (k) => k === 'combo')).toEqual(['me.combo']);
          expect(v.game?.results ?? null).toBeNull();
        }
        // Pujas: solo la propia (me.bid) y las de los ganadores ya resueltos
        for (const path of pathsWithKey(v, (k) => k === 'bid' || k === 'bids')) {
          expect(path).toMatch(/^me\.bid$|winners\.(A|B)\.bid$/);
        }
        if (v.game?.phase === 'PUJAS_ABIERTAS') {
          expect(v.game.resolution).toBeNull();
          for (const m of v.members) expect(typeof m.hasBid).toBe('boolean');
        }
      }
    }

    // Nueva partida con los mismos jugadores y cierre de sala
    await ok(host, 'game:restart');
    await settle(clients, (v) => v.game?.phase === 'FICHAS' && v.game.round === 1 && v.game.log.length === 0);
    const closed = new Promise<void>((r) => luis.socket.on('room:closed', () => r()));
    await ok(host, 'room:close');
    await closed;
    expect(server.rooms.has(code)).toBe(false);
    expect((await luis.call('game:action', { type: 'deal' })).ok).toBe(false);
    for (const c of all) c.socket.disconnect();
  }, 30_000);

  it('el anfitrión puede no jugar y expulsar desde el lobby', async () => {
    const host = await client();
    const { code } = await ok(host, 'room:create', { name: 'Staff', playing: false });
    const a = await client();
    const b = await client();
    const c = await client();
    await ok(a, 'room:join', { code, name: 'A' });
    await ok(b, 'room:join', { code, name: 'B' });
    await ok(c, 'room:join', { code, name: 'C' });
    const kicked = new Promise<void>((r) => c.socket.on('kicked', () => r()));
    await ok(host, 'room:kick', { memberId: (await c.waitFor((v) => !!v.me.id)).me.id });
    await kicked;
    await ok(host, 'game:start');
    const v = await host.waitFor((x) => !!x.game);
    expect(v.me.combo).toBeNull();
    expect(v.me.inGame).toBe(false);
    expect(v.members.filter((m) => m.inGame).map((m) => m.name)).toEqual(['A', 'B']);
    expect((await c.call('game:action', { type: 'bid', bid: { A: 1, B: 0 } })).ok).toBe(false);
    // El anfitrión no puede pujar si no juega
    await ok(host, 'game:action', { type: 'deal' });
    await ok(host, 'game:action', { type: 'open' });
    expect((await host.call('game:action', { type: 'bid', bid: { A: 1, B: 0 } })).error).toBe('No participas en esta partida.');
    await ok(host, 'room:close');
    for (const x of [host, a, b, c]) x.socket.disconnect();
  });
});

describe('cierre automático', () => {
  it('la subasta se cierra sola 5 s después de que todos hayan pujado', async () => {
    const host = await client();
    const { code } = await ok(host, 'room:create', { name: 'Ana', playing: true });
    const luis = await client();
    await ok(luis, 'room:join', { code, name: 'Luis' });
    await ok(host, 'game:start');
    await ok(host, 'game:action', { type: 'deal' });
    await ok(host, 'game:action', { type: 'open' });
    await ok(host, 'game:action', { type: 'bid', bid: { A: 2, B: 0 } });
    const t0 = Date.now();
    await ok(luis, 'game:action', { type: 'bid', bid: { A: 0, B: 0 } });
    const v = await new Promise<ClientView>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no se cerró sola')), 8000);
      host.socket.on('state', (x) => x.game?.phase === 'COLOCACION' && (clearTimeout(t), resolve(x)));
    });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4900);
    expect(v.game!.placement!.playerId).toBe(v.me.id);
    await ok(host, 'room:close');
    host.socket.disconnect();
    luis.socket.disconnect();
  }, 12_000);
});

describe('monedas iniciales', () => {
  it('el anfitrión elige con cuántas monedas empieza cada jugador', async () => {
    const host = await client();
    const { code } = await ok(host, 'room:create', { name: 'Ana', playing: true });
    const luis = await client();
    await ok(luis, 'room:join', { code, name: 'Luis' });
    const base = { auctionTimerS: 0, placementTimerS: 0 };
    expect((await luis.call('room:settings', { ...base, startingCoins: 25 })).ok).toBe(false);
    expect((await host.call('room:settings', { ...base, startingCoins: 0 })).error).toMatch(/de 1 a/);
    await ok(host, 'room:settings', { ...base, startingCoins: 25 });
    await luis.waitFor((v) => v.settings.startingCoins === 25);
    await ok(host, 'game:start');
    const v = await luis.waitFor((x) => !!x.game);
    expect(v.me.coins).toBe(25);
    expect(v.members.map((m) => m.coins)).toEqual([25, 25]);
    // con la partida en marcha no se puede cambiar
    expect((await host.call('room:settings', { ...base, startingCoins: 50 })).ok).toBe(false);
    await ok(host, 'room:close');
    host.socket.disconnect();
    luis.socket.disconnect();
  });
});

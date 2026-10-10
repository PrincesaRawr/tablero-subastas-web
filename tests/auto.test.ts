import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { startServer, type RunningServer } from '../server/app.js';
import type { ClientToServer, ServerToClient } from '../shared/protocol.js';
import type { ClientView } from '../shared/view.js';
import { freeCells } from '../shared/engine.js';
import { seeded } from './helpers.js';

let server: RunningServer;
beforeAll(async () => {
  server = await startServer({ port: 0, rng: seeded(5), autoDelaysMs: { deal: 50, open: 100, next: 100 } });
});
afterAll(async () => {
  await server?.close();
});

function player() {
  const socket: Socket<ServerToClient, ClientToServer> = connect(`http://localhost:${server.port}`, {
    transports: ['websocket'],
    forceNew: true,
  });
  let last: ClientView | null = null;
  const seen: ClientView[] = [];
  socket.on('state', (v) => {
    last = v;
    seen.push(v);
  });
  const call = async (event: keyof ClientToServer, payload: object = {}) => {
    const res = await (socket as any).timeout(3000).emitWithAck(event, payload);
    if (!res.ok) throw new Error(`${event}: ${res.error}`);
    return res;
  };
  const waitFor = (pred: (v: ClientView) => boolean, ms = 3000) =>
    new Promise<ClientView>((resolve, reject) => {
      if (last && pred(last)) return resolve(last);
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      socket.on('state', (v) => pred(v) && (clearTimeout(t), resolve(v)));
    });
  return { socket, call, waitFor, seen, view: () => last! };
}

describe('modo automático', () => {
  it('saca fichas, abre la subasta y pasa de ronda sin que el anfitrión pulse nada', async () => {
    const host = player();
    const luis = player();
    await new Promise((r) => setTimeout(r, 200));
    const { code } = await host.call('room:create', { name: 'Ana', playing: true });
    await luis.call('room:join', { code, name: 'Luis' });
    await host.call('room:settings', { auctionTimerS: 0, placementTimerS: 0, startingCoins: 40, autoAdvance: true });
    await host.call('game:start');

    // ronda 1: fichas y subasta solas, con el aviso visible para todos
    const dealing = await luis.waitFor((v) => v.game?.autoStep?.action === 'deal');
    expect(dealing.game!.autoStep!.at).toBeGreaterThan(0);
    await luis.waitFor((v) => v.game?.phase === 'FICHAS' && !!v.game.auction && v.game.autoStep?.action === 'open');
    await luis.waitFor((v) => v.game?.phase === 'PUJAS_ABIERTAS');
    expect(luis.view().game!.autoStep).toBeNull();

    // pujan (la subasta se cierra sola) y Ana coloca
    await host.call('game:action', { type: 'bid', bid: { A: 2, B: 0 } });
    await luis.call('game:action', { type: 'bid', bid: { A: 0, B: 0 } });
    await host.call('game:action', { type: 'close' }); // el anfitrión puede adelantarse
    const placing = await host.waitFor((v) => v.game?.phase === 'COLOCACION');
    const cells = freeCells(placing.game!.board);
    await host.call('game:action', {
      type: 'place',
      placements: placing.game!.placement!.tokens.map((color, i) => ({ color, ...cells[i] })),
    });

    // pasa sola a la ronda 2 y vuelve a sacar fichas
    await luis.waitFor((v) => v.game?.phase === 'RONDA_CERRADA' && v.game.autoStep?.action === 'next');
    await luis.waitFor((v) => v.game?.round === 2 && !!v.game.auction);

    // al desactivarlo, se para
    await host.call('room:settings', { auctionTimerS: 0, placementTimerS: 0, startingCoins: 40, autoAdvance: false });
    await luis.waitFor((v) => v.game?.autoStep === null);
    await new Promise((r) => setTimeout(r, 300));
    expect(luis.view().game!.phase).toBe('FICHAS');

    await host.call('room:close');
    host.socket.disconnect();
    luis.socket.disconnect();
  });
});

import { describe, expect, it } from 'vitest';
import { createGame, gameReducer, type GameAction, type GameState } from '../shared/game.js';
import { seeded } from './helpers.js';

const settings = { auctionTimerS: 0, placementTimerS: 0 };
const run = (s: GameState, action: GameAction, actorId: string, isHost = false) => {
  const r = gameReducer(s, action, { actorId, isHost, rng: seeded(1), now: 1, settings });
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const tryRun = (s: GameState, action: GameAction, actorId: string, isHost = false) =>
  gameReducer(s, action, { actorId, isHost, rng: seeded(1), now: 1, settings });
const open = (s: GameState) => run(run(s, { type: 'deal' }, 'host', true), { type: 'open' }, 'host', true);

describe('herramientas del anfitrión', () => {
  it('enviar sin pujar (0 y 0) cuenta como enviado y no participa', () => {
    let s = open(createGame(['ana', 'luis'], seeded(1)));
    s = run(s, { type: 'bid', bid: { A: 0, B: 0 } }, 'ana');
    expect(s.bids.ana).toEqual({ A: 0, B: 0 });
    s = run(s, { type: 'bid', bid: { A: 2, B: 0 } }, 'luis');
    s = run(s, { type: 'close' }, 'host', true);
    expect(s.placement?.playerId).toBe('luis');
  });

  it('con 0 monedas se puede enviar sin pujar', () => {
    let s = createGame(['ana', 'luis'], seeded(1));
    s = run(s, { type: 'setCoins', playerId: 'ana', coins: 0 }, 'host', true);
    s = open(s);
    expect(tryRun(s, { type: 'bid', bid: { A: 0, B: 0 } }, 'ana').ok).toBe(true);
    expect(tryRun(s, { type: 'bid', bid: { A: 1, B: 0 } }, 'ana')).toMatchObject({ ok: false });
  });

  it('mirar las pujas: solo el anfitrión, solo con la subasta abierta, y queda en el historial', () => {
    let s = createGame(['ana', 'luis'], seeded(1));
    expect(tryRun(s, { type: 'peek' }, 'host', true)).toMatchObject({ ok: false });
    s = open(s);
    expect(tryRun(s, { type: 'peek' }, 'ana')).toMatchObject({ ok: false });
    s = run(s, { type: 'peek' }, 'host', true);
    expect(s.log.at(-1)).toEqual({ type: 'peek', round: 1, by: 'host' });
  });

  it('añadir y quitar monedas', () => {
    let s = createGame(['ana', 'luis'], seeded(1));
    expect(tryRun(s, { type: 'setCoins', playerId: 'ana', coins: 50 }, 'luis')).toMatchObject({ ok: false });
    s = run(s, { type: 'setCoins', playerId: 'ana', coins: 50 }, 'host', true);
    s = run(s, { type: 'setCoins', playerId: 'luis', coins: 35 }, 'host', true);
    expect(s.players.map((p) => p.coins)).toEqual([50, 35]);
    expect(s.log.map((e) => e.type === 'coins' && [e.playerId, e.from, e.to])).toEqual([
      ['ana', 40, 50],
      ['luis', 40, 35],
    ]);
    expect(tryRun(s, { type: 'setCoins', playerId: 'ana', coins: -1 }, 'host', true)).toMatchObject({ ok: false });
    expect(tryRun(s, { type: 'setCoins', playerId: 'nadie', coins: 5 }, 'host', true)).toMatchObject({ ok: false });
    // no se puede dejar a alguien con menos de lo que ya ha pujado
    s = open(s);
    s = run(s, { type: 'bid', bid: { A: 20, B: 0 } }, 'ana');
    expect(tryRun(s, { type: 'setCoins', playerId: 'ana', coins: 10 }, 'host', true)).toMatchObject({ ok: false });
  });

  it('terminar la partida antes de tiempo', () => {
    let s = open(createGame(['ana', 'luis'], seeded(1)));
    expect(tryRun(s, { type: 'endNow' }, 'ana')).toMatchObject({ ok: false });
    s = run(s, { type: 'endNow' }, 'host', true);
    expect(s.phase).toBe('FIN');
    expect(s.results?.ranking).toHaveLength(2);
    expect(s.log.at(-1)).toEqual({ type: 'ended', round: 1 });
  });
});

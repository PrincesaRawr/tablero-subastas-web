import { describe, expect, it } from 'vitest';
import { NEGOTIATION_TIME_LIMIT_S, STARTING_COINS, TOTAL_ROUNDS } from '../shared/config.js';
import { createGame, gameReducer, myTokens, type GameAction, type GameState } from '../shared/game.js';
import { freeCells, type Placement } from '../shared/engine.js';
import { seeded } from './helpers.js';

const settings = { auctionTimerS: 0, placementTimerS: 0, startingCoins: 40 };
let clock = 1_000_000;

function run(s: GameState, action: GameAction, actorId: string | null, isHost = false): GameState {
  const r = gameReducer(s, action, { actorId, isHost, rng: seeded(clock), now: clock, settings });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
function tryRun(s: GameState, action: GameAction, actorId: string | null, isHost = false) {
  return gameReducer(s, action, { actorId, isHost, rng: seeded(7), now: clock, settings });
}
/** Coloca `tokens` en las primeras casillas libres. */
function firstFree(s: GameState, tokens: GameState['board'][number]): Placement[] {
  const cells = freeCells(s.board);
  return tokens.map((color, i) => ({ color: color!, ...cells[i] }));
}
function toOpenAuction(s: GameState): GameState {
  return run(run(s, { type: 'deal' }, 'host', true), { type: 'open' }, 'host', true);
}

describe('máquina de estados de la partida', () => {
  it('ronda normal 15 vs 17: coloca el ganador de A y se cobran solo las pujas ganadoras', () => {
    let s = createGame(['ana', 'luis', 'eva'], seeded(1));
    expect(s.players.every((p) => p.coins === STARTING_COINS)).toBe(true);
    s = toOpenAuction(s);
    s = run(s, { type: 'bid', bid: { A: 15, B: 0 } }, 'ana');
    s = run(s, { type: 'bid', bid: { A: 3, B: 17 } }, 'luis');
    s = run(s, { type: 'bid', bid: { A: 10, B: 10 } }, 'eva');
    s = run(s, { type: 'close' }, 'host', true);
    expect(s.phase).toBe('COLOCACION');
    expect(s.placement?.playerId).toBe('ana');
    expect(s.placement?.tokens).toEqual(s.auction!.A);
    expect(Object.fromEntries(s.players.map((p) => [p.id, p.coins]))).toEqual({ ana: 25, luis: 23, eva: 40 });

    expect(tryRun(s, { type: 'place', placements: firstFree(s, s.placement!.tokens) }, 'luis')).toMatchObject({ ok: false });
    s = run(s, { type: 'place', placements: firstFree(s, s.placement!.tokens) }, 'ana');
    expect(s.phase).toBe('RONDA_CERRADA');
    expect(s.board.flat().filter(Boolean)).toHaveLength(5);
    expect(s.log.at(-1)).toMatchObject({ type: 'placement', playerIds: ['ana'], random: false });

    s = run(s, { type: 'next' }, 'host', true);
    expect(s.phase).toBe('FICHAS');
    expect(s.round).toBe(2);
  });

  it('solo el anfitrión controla el ritmo y las fases se respetan', () => {
    const s = createGame(['ana', 'luis'], seeded(2));
    expect(tryRun(s, { type: 'deal' }, 'ana')).toEqual({ ok: false, error: 'Solo el anfitrión puede repartir fichas.' });
    expect(tryRun(s, { type: 'open' }, 'host', true)).toMatchObject({ ok: false });
    expect(tryRun(s, { type: 'bid', bid: { A: 1, B: 0 } }, 'ana')).toEqual({ ok: false, error: 'La subasta no está abierta.' });
    const open = toOpenAuction(s);
    expect(tryRun(open, { type: 'bid', bid: { A: 30, B: 20 } }, 'ana')).toEqual({
      ok: false,
      error: 'Tu puja supera tus monedas disponibles.',
    });
    expect(tryRun(open, { type: 'bid', bid: { A: 1, B: 0 } }, 'intruso')).toMatchObject({ ok: false });
    expect(tryRun(open, { type: 'negExpire' }, 'ana')).toMatchObject({ ok: false });
  });

  it('se puede cambiar la puja mientras la subasta está abierta (0 y 0 = no pujar)', () => {
    let s = toOpenAuction(createGame(['ana', 'luis'], seeded(3)));
    s = run(s, { type: 'bid', bid: { A: 5, B: 0 } }, 'ana');
    s = run(s, { type: 'bid', bid: { A: 0, B: 7 } }, 'ana');
    expect(s.bids.ana).toEqual({ A: 0, B: 7 });
    s = run(s, { type: 'bid', bid: { A: 0, B: 0 } }, 'ana');
    expect(s.bids.ana).toEqual({ A: 0, B: 0 });
  });

  it('D7: nadie puja → ronda cerrada sin efectos', () => {
    let s = toOpenAuction(createGame(['ana', 'luis'], seeded(4)));
    s = run(s, { type: 'close' }, 'host', true);
    expect(s.phase).toBe('RONDA_CERRADA');
    expect(s.board.flat().every((c) => c === null)).toBe(true);
    expect(s.players.every((p) => p.coins === STARTING_COINS)).toBe(true);
  });

  it('D5 con pujas iguales: el ganador elige subasta', () => {
    let s = toOpenAuction(createGame(['ana', 'luis'], seeded(5)));
    s = run(s, { type: 'bid', bid: { A: 4, B: 4 } }, 'ana');
    s = run(s, { type: 'close' }, 'host', true);
    expect(s.phase).toBe('RESOLUCION');
    expect(tryRun(s, { type: 'choose', auction: 'A' }, 'luis')).toMatchObject({ ok: false });
    s = run(s, { type: 'choose', auction: 'B' }, 'ana');
    expect(s.phase).toBe('COLOCACION');
    expect(s.placement).toMatchObject({ playerId: 'ana', auction: 'B' });
    expect(s.players.find((p) => p.id === 'ana')!.coins).toBe(32);
  });

  it('el anfitrión puede forzar una colocación aleatoria', () => {
    let s = toOpenAuction(createGame(['ana', 'luis'], seeded(6)));
    s = run(s, { type: 'bid', bid: { A: 2, B: 0 } }, 'ana');
    s = run(s, { type: 'close' }, 'host', true);
    expect(tryRun(s, { type: 'forceRandom' }, 'luis')).toMatchObject({ ok: false });
    s = run(s, { type: 'forceRandom' }, 'host', true);
    expect(s.phase).toBe('RONDA_CERRADA');
    expect(s.board.flat().filter(Boolean)).toHaveLength(5);
    expect(s.log.at(-1)).toMatchObject({ type: 'placement', random: true });
  });

  it('tras la ronda 10 la partida termina y se calculan los resultados', () => {
    let s = createGame(['ana', 'luis'], seeded(8));
    for (let r = 1; r <= TOTAL_ROUNDS; r++) {
      s = toOpenAuction(s);
      s = run(s, { type: 'bid', bid: { A: 1, B: 0 } }, 'ana');
      s = run(s, { type: 'close' }, 'host', true);
      s = run(s, { type: 'place', placements: firstFree(s, s.placement!.tokens) }, 'ana');
      s = run(s, { type: 'next' }, 'host', true);
    }
    expect(s.phase).toBe('FIN');
    expect(s.results!.ranking).toHaveLength(2);
    expect(s.players.find((p) => p.id === 'ana')!.coins).toBe(STARTING_COINS - TOTAL_ROUNDS);
  });
});

/** Celdas libres consecutivas a partir de la n-ésima libre. */
function freeFrom(s: GameState, tokens: GameState['board'][number], skip: number): Placement[] {
  const cells = freeCells(s.board).slice(skip);
  return tokens.map((color, i) => ({ color: color!, ...cells[i] }));
}

describe('negociación (ganan A y B con la misma puja)', () => {
  function toNegotiation() {
    let s = toOpenAuction(createGame(['ana', 'luis', 'eva'], seeded(9)));
    s = run(s, { type: 'bid', bid: { A: 10, B: 0 } }, 'ana');
    s = run(s, { type: 'bid', bid: { A: 0, B: 10 } }, 'luis');
    s = run(s, { type: 'bid', bid: { A: 2, B: 2 } }, 'eva');
    s = run(s, { type: 'close' }, 'host', true);
    return s;
  }

  it('cada uno elige 3 de sus fichas, coloca solo las suyas y al estar los dos de acuerdo se aplican', () => {
    let s = toNegotiation();
    expect(s.phase).toBe('NEGOCIACION');
    expect(s.negotiation!.shared).toBe(false);
    expect(s.players.map((p) => p.coins)).toEqual([30, 30, 40]);

    expect(tryRun(s, { type: 'negPick', indices: [0, 1] }, 'ana')).toMatchObject({ ok: false });
    expect(tryRun(s, { type: 'negPick', indices: [0, 1, 2] }, 'eva')).toMatchObject({ ok: false });
    expect(tryRun(s, { type: 'negSet', placements: [] }, 'ana')).toMatchObject({ ok: false }); // aún no ha elegido
    s = run(s, { type: 'negPick', indices: [0, 1, 2] }, 'ana');
    s = run(s, { type: 'negPick', indices: [4, 3, 2] }, 'luis');
    expect(s.negotiation!.picks.luis).toEqual([2, 3, 4]);
    const ana = myTokens(s.negotiation!, 'ana');
    const luis = myTokens(s.negotiation!, 'luis');

    // colocación en tiempo real y parcial
    s = run(s, { type: 'negSet', placements: freeFrom(s, ana.slice(0, 1), 0) }, 'ana');
    expect(s.negotiation!.live.ana).toHaveLength(1);
    // Luis no puede usar las fichas de Ana ni su casilla
    expect(tryRun(s, { type: 'negSet', placements: freeFrom(s, [...luis, ana[0]], 10) }, 'luis')).toMatchObject({ ok: false });
    expect(tryRun(s, { type: 'negSet', placements: freeFrom(s, luis.slice(0, 1), 0) }, 'luis')).toEqual({
      ok: false,
      error: 'Esa casilla ya está ocupada.',
    });
    s = run(s, { type: 'negSet', placements: freeFrom(s, ana, 0) }, 'ana');
    expect(tryRun(s, { type: 'negAgree' }, 'ana')).toEqual({ ok: false, error: 'Espera a que la otra persona coloque todas sus fichas.' });
    s = run(s, { type: 'negSet', placements: freeFrom(s, luis, 3) }, 'luis');
    s = run(s, { type: 'negAgree' }, 'ana');
    expect(s.phase).toBe('NEGOCIACION');
    // si Luis cambia algo, Ana tiene que volver a estar de acuerdo
    s = run(s, { type: 'negSet', placements: freeFrom(s, luis, 4) }, 'luis');
    expect(s.negotiation!.agreed).toEqual({ ana: false, luis: false });
    s = run(s, { type: 'negAgree' }, 'luis');
    s = run(s, { type: 'negAgree' }, 'ana');
    expect(s.phase).toBe('RONDA_CERRADA');
    expect(s.board.flat().filter(Boolean)).toHaveLength(6);
    expect(s.log.at(-1)).toMatchObject({ type: 'placement', playerIds: ['ana', 'luis'] });
  });

  it('"sin acuerdo" → ronda nula, nadie coloca y ambos pierden la puja', () => {
    let s = toNegotiation();
    s = run(s, { type: 'negPick', indices: [0, 1, 2] }, 'ana');
    s = run(s, { type: 'negSet', placements: freeFrom(s, myTokens(s.negotiation!, 'ana'), 0) }, 'ana');
    s = run(s, { type: 'negNoDeal' }, 'luis');
    expect(s.phase).toBe('RONDA_CERRADA');
    expect(s.board.flat().every((c) => c === null)).toBe(true);
    expect(s.players.map((p) => p.coins)).toEqual([30, 30, 40]);
    expect(s.log.at(-1)).toMatchObject({ type: 'null-round', reason: 'sin-acuerdo' });
  });

  it('si expira el tiempo (D9) → ronda nula', () => {
    const s = toNegotiation();
    expect(s.negotiation!.deadline).toBe(clock + NEGOTIATION_TIME_LIMIT_S * 1000);
    expect(tryRun(s, { type: 'negExpire' }, null)).toMatchObject({ ok: false }); // aún no ha caducado
    const r = gameReducer(s, { type: 'negExpire' }, { actorId: null, isHost: false, rng: seeded(1), now: s.negotiation!.deadline, settings });
    expect(r.ok && r.state.phase).toBe('RONDA_CERRADA');
    expect(r.ok && r.state.log.at(-1)).toMatchObject({ type: 'null-round', reason: 'tiempo' });
  });
});

describe('empate en la misma subasta', () => {
  function toSharedTie() {
    let s = toOpenAuction(createGame(['ana', 'luis', 'eva'], seeded(11)));
    s = run(s, { type: 'bid', bid: { A: 4, B: 0 } }, 'ana');
    s = run(s, { type: 'bid', bid: { A: 4, B: 0 } }, 'luis');
    return run(s, { type: 'close' }, 'host', true);
  }

  it('cada uno elige 2 fichas distintas a las del otro, coloca las suyas y tienen que estar de acuerdo', () => {
    let s = toSharedTie();
    expect(s.phase).toBe('NEGOCIACION');
    expect(s.negotiation!.shared).toBe(true);
    expect(s.players.map((p) => p.coins)).toEqual([36, 36, 40]);

    expect(tryRun(s, { type: 'negPick', indices: [0, 1, 2] }, 'ana')).toMatchObject({ ok: false });
    s = run(s, { type: 'negPick', indices: [0, 1] }, 'ana');
    expect(tryRun(s, { type: 'negPick', indices: [1, 2] }, 'luis')).toEqual({
      ok: false,
      error: 'Esa ficha ya la ha elegido la otra persona.',
    });
    s = run(s, { type: 'negPick', indices: [3, 4] }, 'luis');
    s = run(s, { type: 'negSet', placements: freeFrom(s, myTokens(s.negotiation!, 'luis'), 0) }, 'luis');
    s = run(s, { type: 'negSet', placements: freeFrom(s, myTokens(s.negotiation!, 'ana'), 2) }, 'ana');
    s = run(s, { type: 'negAgree' }, 'ana');
    s = run(s, { type: 'negAgree' }, 'luis');
    expect(s.phase).toBe('RONDA_CERRADA');
    expect(s.board.flat().filter(Boolean)).toHaveLength(4); // la quinta ficha se descarta
  });

  it('también se puede declarar sin acuerdo', () => {
    let s = toSharedTie();
    s = run(s, { type: 'negNoDeal' }, 'ana');
    expect(s.phase).toBe('RONDA_CERRADA');
    expect(s.log.at(-1)).toMatchObject({ type: 'null-round', reason: 'sin-acuerdo' });
  });
});

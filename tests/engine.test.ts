import { describe, expect, it } from 'vitest';
import { COLORS, MAX_PLAYERS, type Color } from '../shared/config.js';
import {
  MAX_DISTINCT_COMBOS,
  applyCoinLoss,
  assignCombos,
  computeFinalResults,
  emptyBoard,
  findOccurrences,
  formatPlacements,
  randomPlacements,
  resolveAuctions,
  validateBid,
  validatePlacements,
} from '../shared/engine.js';
import { boardWith, p, seeded } from './helpers.js';

const RBN: Color[] = ['rosa', 'azul', 'naranja'];
const cells = (occ: { row: number; col: number }[]) => occ.map((c) => `${'ABCDEFGH'[c.col]}${c.row + 1}`).join('-');

describe('reparto de combinaciones (D2)', () => {
  it('son únicas, sin inversas y con colores distintos', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const combos = assignCombos(MAX_PLAYERS, seeded(seed));
      expect(combos).toHaveLength(MAX_PLAYERS);
      const keys = new Set<string>();
      for (const c of combos) {
        expect(c).toHaveLength(3);
        expect(new Set(c).size).toBe(3);
        c.forEach((color) => expect(COLORS).toContain(color));
        const k = c.join('>');
        const rev = [...c].reverse().join('>');
        expect(keys.has(k)).toBe(false);
        expect(keys.has(rev)).toBe(false);
        keys.add(k);
        keys.add(rev);
      }
    }
  });

  it('admite hasta 30 jugadores y falla por encima', () => {
    expect(MAX_DISTINCT_COMBOS).toBe(30);
    expect(assignCombos(30, seeded(3))).toHaveLength(30);
    expect(() => assignCombos(31, seeded(3))).toThrow();
  });
});

describe('cálculo de apariciones', () => {
  it('tablero vacío → 0', () => {
    expect(findOccurrences(emptyBoard(), RBN)).toEqual([]);
  });

  it('horizontal', () => {
    const occ = findOccurrences(boardWith('rosa A1', 'azul B1', 'naranja C1'), RBN);
    expect(occ.map(cells)).toEqual(['A1-B1-C1']);
  });

  it('vertical', () => {
    const occ = findOccurrences(boardWith('rosa H6', 'azul H7', 'naranja H8'), RBN);
    expect(occ.map(cells)).toEqual(['H6-H7-H8']);
  });

  it('diagonal ↘ y diagonal ↗', () => {
    expect(findOccurrences(boardWith('rosa A1', 'azul B2', 'naranja C3'), RBN).map(cells)).toEqual(['A1-B2-C3']);
    expect(findOccurrences(boardWith('rosa A8', 'azul B7', 'naranja C6'), RBN).map(cells)).toEqual(['A8-B7-C6']);
  });

  it('se lee en sentido inverso (las casillas se devuelven en el orden de la combinación)', () => {
    const occ = findOccurrences(boardWith('naranja D4', 'azul E4', 'rosa F4'), RBN);
    expect(occ.map(cells)).toEqual(['F4-E4-D4']);
  });

  it('el orden importa: una permutación distinta no cuenta', () => {
    expect(findOccurrences(boardWith('azul A1', 'rosa B1', 'naranja C1'), RBN)).toHaveLength(0);
  });

  it('las apariciones solapadas cuentan por separado', () => {
    // rosa azul naranja azul rosa → dos apariciones que comparten la naranja
    const b = boardWith('rosa A1', 'azul B1', 'naranja C1', 'azul D1', 'rosa E1');
    expect(findOccurrences(b, RBN).map(cells)).toEqual(['A1-B1-C1', 'E1-D1-C1']);
    // misma ficha en horizontal y vertical
    const b2 = boardWith('rosa A1', 'azul B1', 'naranja C1', 'azul A2', 'naranja A3');
    expect(findOccurrences(b2, RBN)).toHaveLength(2);
  });

  it('reproduce el tablero de referencias/ejemplo_tablero.png (4 apariciones)', () => {
    const b = boardWith(
      'morado B2', 'verde C2', 'naranja D2', 'verde F2', 'morado G2',
      'rosa B3', 'morado E3', 'naranja G3',
      'naranja B4', 'azul C4', 'rosa D4', 'verde E4', 'azul F4',
      'verde B5', 'naranja D5', 'rosa E5', 'verde G5',
      'morado A6', 'morado D6', 'naranja E6',
      'naranja B7', 'azul C7', 'rosa D7', 'verde E7', 'verde G7', 'morado H7',
      'verde C8', 'morado E8', 'rosa F8', 'naranja G8', 'azul H8',
    );
    const occ = findOccurrences(b, RBN).map(cells).sort();
    expect(occ).toEqual(['B3-C4-D5', 'D4-C4-B4', 'D7-C7-B7', 'E5-F4-G3']);
  });
});

describe('pujas (D3)', () => {
  it('acepta pujas válidas y retirar la puja', () => {
    expect(validateBid(40, { A: 15, B: 0 })).toBeNull();
    expect(validateBid(40, { A: 20, B: 20 })).toBeNull();
    expect(validateBid(0, { A: 0, B: 0 })).toBeNull();
  });
  it('rechaza pujas inválidas', () => {
    expect(validateBid(40, { A: 30, B: 11 })).toBe('Tu puja supera tus monedas disponibles.');
    expect(validateBid(40, { A: -1, B: 0 })).toMatch(/negativas/);
    expect(validateBid(40, { A: 1.5, B: 0 })).toMatch(/enteros/);
    expect(validateBid(0, { A: 1, B: 0 })).toMatch(/No te quedan monedas/);
    expect(validateBid(40, { A: '3' as unknown as number, B: 0 })).toMatch(/enteros/);
  });
});

describe('resolución de ronda', () => {
  const rng = seeded(1);

  it('ganador normal: A con 15 y B con 17 → recibe el de A', () => {
    const r = resolveAuctions({ ana: { A: 15, B: 0 }, luis: { A: 3, B: 17 }, eva: { A: 0, B: 5 } }, rng);
    expect(r.outcome).toBe('normal');
    expect(r.winners.A).toMatchObject({ playerId: 'ana', bid: 15 });
    expect(r.winners.B).toMatchObject({ playerId: 'luis', bid: 17 });
    expect(r.recipient).toEqual({ playerId: 'ana', auction: 'A' });
    // los ganadores pierden su puja ganadora; el resto lo recupera todo
    expect(r.coinsLost).toEqual({ ana: 15, luis: 17 });
    expect(applyCoinLoss({ ana: 40, luis: 40, eva: 40 }, r.coinsLost)).toEqual({ ana: 25, luis: 23, eva: 40 });
  });

  it('empate entre los dos ganadores → negociación', () => {
    const r = resolveAuctions({ ana: { A: 10, B: 0 }, luis: { A: 0, B: 10 } }, rng);
    expect(r.outcome).toBe('tie');
    expect(r.recipient).toBeNull();
    expect(r.coinsLost).toEqual({ ana: 10, luis: 10 });
  });

  it('empate de 2 en la misma subasta que da fichas → negocian sus 5 fichas, pierden los dos', () => {
    const r = resolveAuctions({ ana: { A: 8, B: 0 }, luis: { A: 8, B: 0 }, eva: { A: 0, B: 12 } }, rng);
    expect(r.outcome).toBe('shared-tie');
    expect(r.sharedAuction).toBe('A');
    expect(r.winners.A).toMatchObject({ playerId: 'ana', coWinner: 'luis', bid: 8 });
    expect(r.recipient).toBeNull();
    expect(r.coinsLost).toEqual({ ana: 8, luis: 8, eva: 12 });
    // también si solo hubo pujas en esa subasta
    expect(resolveAuctions({ ana: { A: 0, B: 3 }, luis: { A: 0, B: 3 } }, rng).outcome).toBe('shared-tie');
  });

  it('empate de 2 en la subasta que NO da fichas → recibe el otro ganador; la pareja pierde la puja', () => {
    const r = resolveAuctions({ ana: { A: 8, B: 0 }, luis: { A: 8, B: 0 }, eva: { A: 0, B: 5 } }, rng);
    expect(r.outcome).toBe('normal');
    expect(r.recipient).toEqual({ playerId: 'eva', auction: 'B' });
    expect(r.coinsLost).toEqual({ ana: 8, luis: 8, eva: 5 });
  });

  it('D4: con 3 o más empatados en una subasta → desempate aleatorio y anunciado', () => {
    const winners = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      const r = resolveAuctions({ ana: { A: 8, B: 0 }, luis: { A: 8, B: 0 }, eva: { A: 8, B: 0 } }, seeded(seed));
      const w = r.winners.A!;
      winners.add(w.playerId);
      expect(r.outcome).toBe('single');
      expect(w.coWinner).toBeNull();
      expect(w.tiedWith.sort()).toEqual(['ana', 'eva', 'luis'].filter((p) => p !== w.playerId));
      expect(r.coinsLost).toEqual({ [w.playerId]: 8 });
    }
    expect(winners).toEqual(new Set(['ana', 'luis', 'eva']));
  });

  it('si las dos subastas acaban con la misma puja, la pareja se desempata al azar y negocian los ganadores', () => {
    const r = resolveAuctions({ ana: { A: 6, B: 0 }, luis: { A: 6, B: 0 }, eva: { A: 0, B: 6 } }, seeded(3));
    expect(r.outcome).toBe('tie');
    expect(r.winners.A!.coWinner).toBeNull();
    expect(r.winners.A!.tiedWith).toHaveLength(1);
  });

  it('D5: el mismo jugador gana A y B → recibe donde pujó menos y pierde ambas', () => {
    const r = resolveAuctions({ ana: { A: 9, B: 4 }, luis: { A: 2, B: 1 } }, rng);
    expect(r.outcome).toBe('same-player');
    expect(r.recipient).toEqual({ playerId: 'ana', auction: 'B' });
    expect(r.coinsLost).toEqual({ ana: 13 });
  });

  it('D5: mismo jugador con la misma puja en ambas → elige él', () => {
    const r = resolveAuctions({ ana: { A: 6, B: 6 } }, rng);
    expect(r.outcome).toBe('same-player-choice');
    expect(r.recipient).toBeNull();
    expect(r.coinsLost).toEqual({ ana: 12 });
  });

  it('D6: solo hay un ganador', () => {
    const r = resolveAuctions({ ana: { A: 0, B: 3 }, luis: { A: 0, B: 2 } }, rng);
    expect(r.outcome).toBe('single');
    expect(r.recipient).toEqual({ playerId: 'ana', auction: 'B' });
    expect(r.coinsLost).toEqual({ ana: 3 });
  });

  it('D7: nadie puja', () => {
    const r = resolveAuctions({}, rng);
    expect(r.outcome).toBe('none');
    expect(r.recipient).toBeNull();
    expect(r.coinsLost).toEqual({});
  });
});

describe('colocación (D8)', () => {
  const tokens: Color[] = ['rosa', 'rosa', 'azul', 'verde', 'morado'];
  const ok = ['rosa A1', 'rosa B1', 'azul C1', 'verde D1', 'morado E1'].map(p);

  it('acepta una colocación correcta y la formatea', () => {
    expect(validatePlacements(emptyBoard(), tokens, ok)).toBeNull();
    expect(formatPlacements(ok)).toBe('Rosa A1, Rosa B1, Azul C1, Verde D1, Morado E1');
  });
  it('rechaza casillas ocupadas, repetidas, fichas ajenas o número incorrecto', () => {
    expect(validatePlacements(boardWith('azul A1'), tokens, ok)).toMatch(/A1 ya está ocupada/);
    expect(validatePlacements(emptyBoard(), tokens, [...ok.slice(0, 4), p('morado A1')])).toMatch(/misma casilla/);
    expect(validatePlacements(emptyBoard(), tokens, [...ok.slice(0, 4), p('naranja E1')])).toMatch(/no tienes/);
    expect(validatePlacements(emptyBoard(), tokens, ok.slice(0, 4))).toMatch(/exactamente 5/);
    expect(validatePlacements(emptyBoard(), tokens, [...ok.slice(0, 4), { color: 'morado', row: 8, col: 0 }])).toMatch(/no existe/);
  });
  it('la colocación aleatoria usa casillas libres', () => {
    const board = boardWith('azul A1');
    const placed = randomPlacements(board, tokens, seeded(5));
    expect(validatePlacements(board, tokens, placed)).toBeNull();
  });
});

describe('final (D10)', () => {
  it('gana quien más apariciones tiene; los empatados ganan todos', () => {
    const b = boardWith('rosa A1', 'azul B1', 'naranja C1', 'verde A3', 'morado B3', 'rosa C3');
    const res = computeFinalResults(b, [
      { id: 'ana', combo: ['rosa', 'azul', 'naranja'] },
      { id: 'luis', combo: ['verde', 'morado', 'rosa'] },
      { id: 'eva', combo: ['azul', 'verde', 'morado'] },
    ]);
    expect(res.ranking.map((r) => [r.playerId, r.count])).toEqual([['ana', 1], ['luis', 1], ['eva', 0]]);
    expect(res.winners).toEqual(['ana', 'luis']);
  });
});

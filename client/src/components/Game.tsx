import { useEffect, useMemo, useRef, useState } from 'react';
import type { Color } from '../../../shared/config';
import { applyPlacements, findOccurrences, type AuctionId, type Cell, type Placement } from '../../../shared/engine';
import type { ClientView } from '../../../shared/view';
import type { PeekedBid } from '../../../shared/protocol';
import { act, call, forgetSession, showToast } from '../store';
import { PHASE_LABEL, describeSlots, joinNames, logText, nameResolver, resolutionVerdict, winnerLine, type NameOf } from '../text';
import { usePlacementDraft, type PlacementDraft } from '../usePlacementDraft';
import { Board } from './Board';
import { Chat } from './Chat';
import { Countdown, DraftTray, TokenRow } from './common';
import { Token } from './Token';

type GameView = NonNullable<ClientView['game']>;

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* sin almacenamiento */
  }
}

export function Game({ view, onRules }: { view: ClientView; onRules: () => void }) {
  const g = view.game!;
  const me = view.me;
  const nameOf = nameResolver(view);

  // Aviso a todos cuando el anfitrión mira las pujas o cambia monedas (solo entradas nuevas).
  const seenLog = useRef(g.log.length);
  useEffect(() => {
    const fresh = g.log.slice(seenLog.current);
    seenLog.current = g.log.length;
    for (const e of fresh) {
      if ((e.type === 'peek' && e.by !== me.id) || e.type === 'coins') showToast(logText(e, nameOf), 'info');
    }
  }, [g.log.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const [comboVisible, setComboVisible] = useState(() => readPref('ts:combo-visible', true));
  const [highlightMine, setHighlightMine] = useState(false);
  const [finalHighlight, setFinalHighlight] = useState<string | null>(null);

  // ── colocación normal ──
  const placingMe = g.phase === 'COLOCACION' && g.placement?.playerId === me.id;
  const placeTokens = placingMe ? g.placement!.tokens : NO_TOKENS;
  const placeDraft = usePlacementDraft(placeTokens, `${g.round}-${placingMe}`);

  // ── negociación: cada uno coloca sus fichas y el otro las ve en tiempo real ──
  const neg = g.negotiation;
  const amNegotiator = !!neg?.picks;
  // mis fichas: las de todas mis plazas, solo cuando ya las he elegido todas
  const myNegTokens = useMemo<Color[]>(() => {
    if (!amNegotiator) return NO_TOKENS;
    const mine = neg!.slots.map((sl, j) => ({ sl, j })).filter(({ sl }) => sl.playerId === me.id);
    if (!mine.length || mine.some(({ j }) => !neg!.picks![j])) return NO_TOKENS;
    return mine.flatMap(({ sl, j }) => neg!.picks![j]!.map((i) => neg!.pools[sl.auction]![i]));
  }, [amNegotiator, neg, me.id]);
  const myLive = (amNegotiator && neg!.live![me.id]) || NO_PLACEMENTS;
  const otherLive = useMemo(
    () => (amNegotiator ? neg!.players.filter((p) => p !== me.id).flatMap((p) => neg!.live![p]) : NO_PLACEMENTS),
    [amNegotiator, neg, me.id],
  );
  const usedIdx = usedTokenIndices(myNegTokens, myLive);
  const [negSelected, setNegSelected] = useState<number | null>(null);
  useEffect(() => setNegSelected(null), [g.round, myNegTokens.join()]);
  const negClick = (cell: Cell) => {
    const mine = myLive.find((p) => p.row === cell.row && p.col === cell.col);
    if (mine) {
      act({ type: 'negSet', placements: myLive.filter((p) => p !== mine) });
      return;
    }
    const free = myNegTokens.map((_, i) => i).filter((i) => !usedIdx.has(i));
    const idx = negSelected !== null && free.includes(negSelected) ? negSelected : free[0];
    if (idx === undefined) return;
    act({ type: 'negSet', placements: [...myLive, { color: myNegTokens[idx], ...cell }] });
    setNegSelected(null);
  };

  // ── tablero: fichas provisionales, clic y resaltado ──
  let ghosts = placingMe ? placeDraft.placements : NO_PLACEMENTS;
  let onCellClick: ((c: Cell) => void) | undefined = placingMe ? placeDraft.clickCell : undefined;
  if (amNegotiator) {
    ghosts = myLive;
    if (myNegTokens.length) onCellClick = negClick;
  }

  const myOccurrences = useMemo(() => (me.combo ? findOccurrences(g.board, me.combo) : []), [g.board, me.combo]);
  const previewCount = useMemo(
    () =>
      me.combo && ghosts.length + otherLive.length
        ? findOccurrences(applyPlacements(g.board, [...ghosts, ...otherLive]), me.combo).length
        : null,
    [g.board, ghosts, otherLive, me.combo],
  );

  let highlights: Cell[][] = [];
  if (g.phase === 'FIN' && g.results) {
    const target = finalHighlight ?? g.results.winners[0];
    highlights = g.results.ranking.find((r) => r.playerId === target)?.occurrences ?? [];
  } else if (highlightMine && comboVisible) highlights = myOccurrences;

  const lastPlacement = g.log.at(-1);
  const recent = lastPlacement?.type === 'placement' && lastPlacement.round === g.round ? lastPlacement.placements : [];

  return (
    <main className="game">
      <header className="topbar">
        <div className="topbar-left">
          <span className="pill">Sala {view.code}</span>
          <span className="pill strong">
            Ronda {g.round}/{g.totalRounds}
          </span>
          <span className="pill phase">{PHASE_LABEL[g.phase]}</span>
        </div>
        <div className="topbar-right">
          {me.coins !== null && (
            <span className="pill coins" title="Tus monedas">
              🪙 {me.coins}
            </span>
          )}
          <button className="btn ghost small" onClick={onRules}>
            📖 Reglas
          </button>
        </div>
      </header>

      <div className="game-layout">
        <section className="board-col">
          <Board
            board={g.board}
            ghosts={ghosts}
            otherGhosts={otherLive}
            highlights={highlights}
            recent={recent}
            onCellClick={onCellClick}
          />

          {me.combo && g.phase !== 'FIN' && (
            <ComboBar
              combo={me.combo}
              visible={comboVisible}
              onToggle={() => {
                writePref('ts:combo-visible', !comboVisible);
                setComboVisible(!comboVisible);
                if (comboVisible) setHighlightMine(false);
              }}
              highlight={highlightMine}
              onHighlight={() => setHighlightMine(!highlightMine)}
              count={myOccurrences.length}
              previewCount={previewCount}
            />
          )}
          {!me.inGame && g.phase !== 'FIN' && (
            <p className="hint center">Eres el anfitrión y no juegas: diriges la partida.</p>
          )}
        </section>

        <aside className="side-col">
          <PhasePanel
            view={view}
            g={g}
            nameOf={nameOf}
            placeDraft={placeDraft}
            neg={{ tokens: myNegTokens, used: usedIdx, selected: negSelected, select: setNegSelected, live: myLive }}
            finalHighlight={finalHighlight ?? g.results?.winners[0] ?? null}
            setFinalHighlight={setFinalHighlight}
          />
          <Players view={view} g={g} />
          <History g={g} nameOf={nameOf} />
          {me.isHost && g.phase !== 'FIN' && <HostTools />}
        </aside>
      </div>
      {g.phase !== 'FIN' && <Chat view={view} />}
    </main>
  );
}

const NO_TOKENS: Color[] = [];
const NO_PLACEMENTS: Placement[] = [];

/** Índices de mis fichas que ya están en el tablero provisional (emparejando por color). */
function usedTokenIndices(tokens: Color[], live: Placement[]): Set<number> {
  const used = new Set<number>();
  for (const p of live) {
    const i = tokens.findIndex((c, k) => c === p.color && !used.has(k));
    if (i >= 0) used.add(i);
  }
  return used;
}

interface NegDraft {
  tokens: Color[];
  used: Set<number>;
  selected: number | null;
  select: (i: number) => void;
  live: Placement[];
}

// ───────────────────────── combinación secreta ─────────────────────────

function ComboBar(props: {
  combo: Color[];
  visible: boolean;
  onToggle: () => void;
  highlight: boolean;
  onHighlight: () => void;
  count: number;
  previewCount: number | null;
}) {
  const { combo, visible, onToggle, highlight, onHighlight, count, previewCount } = props;
  return (
    <section className="combo-bar card" aria-label="Tu combinación secreta">
      <div className="combo-slots">
        {combo.map((c, i) => (
          <div className="combo-slot" key={i}>
            {visible ? <Token color={c} size={56} /> : <span className="combo-hidden">?</span>}
          </div>
        ))}
      </div>
      <div className="combo-info">
        <div className="combo-title">Tu combinación secreta</div>
        {visible && (
          <div className="combo-count" aria-live="polite">
            Ahora mismo tienes <b>{count}</b> {count === 1 ? 'aparición' : 'apariciones'}
            {previewCount !== null && previewCount !== count && (
              <span className="preview"> · con esta colocación: {previewCount}</span>
            )}
          </div>
        )}
        <div className="row-buttons">
          <button className="btn ghost small" onClick={onToggle} aria-pressed={!visible}>
            {visible ? '🙈 Ocultar' : '👀 Mostrar'}
          </button>
          {visible && (
            <button className={`btn small ${highlight ? 'primary' : 'ghost'}`} onClick={onHighlight} aria-pressed={highlight}>
              ✨ Resaltar mis apariciones
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ───────────────────────── panel de la fase ─────────────────────────

interface PanelProps {
  view: ClientView;
  g: GameView;
  nameOf: NameOf;
  placeDraft: PlacementDraft;
  neg: NegDraft;
  finalHighlight: string | null;
  setFinalHighlight: (id: string) => void;
}

function PhasePanel(p: PanelProps) {
  const { g } = p;
  return (
    <section className="card phase-panel" aria-live="polite">
      {g.phase === 'FICHAS' && <DealPanel {...p} />}
      {g.phase === 'PUJAS_ABIERTAS' && <BidPanel {...p} />}
      {g.resolution && ['RESOLUCION', 'NEGOCIACION', 'COLOCACION', 'RONDA_CERRADA'].includes(g.phase) && (
        <Reveal g={g} nameOf={p.nameOf} />
      )}
      {g.phase === 'RESOLUCION' && <ChoosePanel {...p} />}
      {g.phase === 'COLOCACION' && <PlacePanel {...p} />}
      {g.phase === 'NEGOCIACION' && <NegotiationPanel {...p} />}
      {g.phase === 'RONDA_CERRADA' && <ClosedPanel {...p} />}
      {g.phase === 'FIN' && <FinalPanel {...p} />}
    </section>
  );
}

function Auctions({ g }: { g: GameView }) {
  if (!g.auction) return null;
  return (
    <div className="auctions">
      {(['A', 'B'] as const).map((id) => (
        <div className="auction" key={id}>
          <div className="auction-name">Subasta {id}</div>
          <TokenRow tokens={g.auction![id]} size={38} label={`Fichas de la subasta ${id}`} />
        </div>
      ))}
    </div>
  );
}

function DealPanel({ view, g }: PanelProps) {
  const host = view.me.isHost;
  return (
    <>
      <h2>Ronda {g.round}</h2>
      {g.auction ? <Auctions g={g} /> : <p className="muted">Aún no se han repartido las fichas.</p>}
      {host ? (
        <div className="row-buttons">
          {!g.auction ? (
            <button className="btn primary" onClick={() => act({ type: 'deal' })}>
              🎲 Repartir fichas
            </button>
          ) : (
            <button className="btn primary" onClick={() => act({ type: 'open' })}>
              🔨 Abrir subasta
            </button>
          )}
        </div>
      ) : (
        <p className="hint">Esperando al anfitrión…</p>
      )}
    </>
  );
}

function BidPanel({ view, g }: PanelProps) {
  const me = view.me;
  const [a, setA] = useState(String(me.bid?.A ?? 0));
  const [b, setB] = useState(String(me.bid?.B ?? 0));
  useEffect(() => {
    setA(String(me.bid?.A ?? 0));
    setB(String(me.bid?.B ?? 0));
  }, [me.bid?.A, me.bid?.B]);

  const numA = Math.max(0, Math.floor(Number(a) || 0));
  const numB = Math.max(0, Math.floor(Number(b) || 0));
  const coins = me.coins ?? 0;
  const left = coins - numA - numB;
  const over = left < 0;
  const changed = numA !== (me.bid?.A ?? 0) || numB !== (me.bid?.B ?? 0);
  const players = view.members.filter((m) => m.inGame);
  const bidders = players.filter((m) => m.hasBid).length;

  const stepper = (value: string, set: (v: string) => void, id: 'A' | 'B') => (
    <div className="stepper">
      <button type="button" className="btn small ghost" aria-label={`Bajar puja ${id}`} onClick={() => set(String(Math.max(0, (Number(value) || 0) - 1)))}>
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={coins}
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-label={`Puja en la subasta ${id}`}
      />
      <button type="button" className="btn small ghost" aria-label={`Subir puja ${id}`} onClick={() => set(String((Number(value) || 0) + 1))}>
        +
      </button>
    </div>
  );

  return (
    <>
      <div className="panel-head">
        <h2>¡Subasta abierta!</h2>
        <Countdown deadline={g.auctionDeadline} />
      </div>
      {g.autoCloseAt && (
        <p className="auto-close" role="status" key={g.autoCloseAt}>
          ✅ Todos han enviado su puja. Se cierra sola en <Countdown deadline={g.autoCloseAt} /> si nadie la cambia.
        </p>
      )}
      <Auctions g={g} />
      {me.inGame && (
        <form
          className="bid-form"
          onSubmit={(e) => {
            e.preventDefault();
            act({ type: 'bid', bid: { A: numA, B: numB } });
          }}
        >
          <div className="bid-inputs">
            <label>
              <span>Puja A</span>
              {stepper(a, setA, 'A')}
            </label>
            <label>
              <span>Puja B</span>
              {stepper(b, setB, 'B')}
            </label>
          </div>
          <p className={`bid-summary${over ? ' error' : ''}`}>
            {over ? 'Tu puja supera tus monedas disponibles.' : `Disponibles: ${coins} · Te quedarían: ${left}`}
          </p>
          <p className="hint">
            0 = no participas en esa subasta. Puedes enviar 0 y 0 para no pujar esta ronda. Las cantidades son secretas
            (solo el anfitrión puede mirarlas, y si lo hace se avisa a todos).
          </p>
          <div className="row-buttons">
            <button className="btn primary" type="submit" disabled={over || (!!me.bid && !changed)}>
              {numA === 0 && numB === 0 ? '🙅 Enviar sin pujar' : me.bid ? 'Actualizar puja' : 'Enviar puja'}
            </button>
          </div>
          {me.bid && (
            <p className="sent">
              {me.bid.A === 0 && me.bid.B === 0
                ? '✓ Enviado: no pujas esta ronda'
                : `✓ Puja enviada: A ${me.bid.A} · B ${me.bid.B}`}
            </p>
          )}
          {coins === 0 && <p className="hint">No te quedan monedas: esta ronda solo puedes enviar sin pujar.</p>}
        </form>
      )}
      <p className="muted small">
        Han enviado {bidders} de {players.length}
      </p>
      {view.me.isHost && <HostPeek view={view} g={g} />}
      {view.me.isHost && (
        <div className="row-buttons">
          <button className="btn primary" onClick={() => act({ type: 'close' })}>
            🔔 Cerrar subasta
          </button>
        </div>
      )}
    </>
  );
}

/** El anfitrión puede ver las pujas; cada vez que mira, queda registrado y se avisa a todos. */
function HostPeek({ view, g }: { view: ClientView; g: GameView }) {
  const [bids, setBids] = useState<PeekedBid[] | null>(null);
  useEffect(() => setBids(null), [g.round, g.phase]);
  const nameOf = nameResolver(view);

  const peek = async () => {
    if (!bids && !confirm('Todos verán en el historial que has mirado las pujas. ¿Mirar?')) return;
    const res = await act({ type: 'peek' });
    if (res?.bids) setBids(res.bids);
  };

  return (
    <div className="peek">
      <button className="btn ghost small" onClick={peek}>
        👀 {bids ? 'Actualizar pujas' : 'Ver pujas de todos'}
      </button>
      {bids && (
        <table className="peek-table">
          <thead>
            <tr>
              <th>Jugador</th>
              <th>A</th>
              <th>B</th>
            </tr>
          </thead>
          <tbody>
            {bids.map(({ playerId, bid }) => (
              <tr key={playerId}>
                <td>{nameOf(playerId)}</td>
                {bid ? (
                  bid.A === 0 && bid.B === 0 ? (
                    <td colSpan={2} className="muted">no puja</td>
                  ) : (
                    <>
                      <td>{bid.A || '—'}</td>
                      <td>{bid.B || '—'}</td>
                    </>
                  )
                ) : (
                  <td colSpan={2} className="muted">sin enviar</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Reveal({ g, nameOf }: { g: GameView; nameOf: NameOf }) {
  const r = g.resolution!;
  return (
    <div className="reveal" key={g.round}>
      <h2>Resultado de la subasta</h2>
      <ul className="reveal-list">
        {(['A', 'B'] as const).map((id, i) => (
          <li key={id} className={`reveal-item${r.recipient?.auction === id || r.slots?.some((sl) => sl.auction === id) ? ' won' : ''}`} style={{ animationDelay: `${i * 350}ms` }}>
            {winnerLine(r, id, nameOf)}
          </li>
        ))}
      </ul>
      <p className="reveal-verdict" style={{ animationDelay: '800ms' }}>
        {resolutionVerdict(r, nameOf)}
      </p>
    </div>
  );
}

function ChoosePanel({ view, g, nameOf }: PanelProps) {
  const winner = g.resolution!.winners.A!.playerIds[0];
  if (winner !== view.me.id) return <p className="hint">Esperando a que {nameOf(winner)} elija subasta…</p>;
  return (
    <>
      <p>Has ganado las dos subastas con la misma puja. ¿Con qué fichas te quedas?</p>
      <div className="choose">
        {(['A', 'B'] as const).map((id) => (
          <button key={id} className="btn choose-btn" onClick={() => act({ type: 'choose', auction: id })}>
            <span>Subasta {id}</span>
            <TokenRow tokens={g.auction![id]} size={30} />
          </button>
        ))}
      </div>
    </>
  );
}

function PlacePanel({ view, g, nameOf, placeDraft }: PanelProps) {
  const pl = g.placement!;
  const mine = pl.playerId === view.me.id;
  return (
    <>
      <div className="panel-head">
        <h3>{mine ? '¡Te toca colocar!' : `${nameOf(pl.playerId)} está colocando…`}</h3>
        <Countdown deadline={pl.deadline} />
      </div>
      {mine ? (
        <>
          <DraftTray tokens={pl.tokens} draft={placeDraft} />
          <button
            className="btn primary wide"
            disabled={!placeDraft.complete}
            onClick={() => act({ type: 'place', placements: placeDraft.placements })}
          >
            ✓ Confirmar colocación
          </button>
        </>
      ) : (
        <TokenRow tokens={pl.tokens} size={34} label="Fichas que se van a colocar" />
      )}
      {view.me.isHost && !mine && (
        <button
          className="btn ghost small"
          onClick={() => confirm('¿Colocar las fichas al azar?') && act({ type: 'forceRandom' })}
        >
          🎲 Forzar colocación aleatoria
        </button>
      )}
    </>
  );
}

function NegotiationPanel({ view, g, nameOf, neg: draft }: PanelProps) {
  const n = g.negotiation!;
  const me = view.me.id;
  const amIn = !!n.picks;
  const others = n.players.filter((p) => p !== me);
  const mySlots = n.slots.map((sl, j) => ({ sl, j })).filter(({ sl }) => sl.playerId === me);

  const total = (p: string) => n.slots.filter((sl) => sl.playerId === p).reduce((a, sl) => a + sl.pick, 0);
  const count = (p: string) => n.live?.[p]?.length ?? 0;
  const complete = (p: string) => n.ready[p] && count(p) === total(p);
  const status = (
    <ul className="neg-status">
      {n.players.map((p) => (
        <li key={p}>
          {nameOf(p)}:{' '}
          {n.agreed[p]
            ? '✓ está de acuerdo'
            : !n.ready[p]
              ? 'eligiendo fichas…'
              : amIn
                ? `colocando (${count(p)}/${total(p)})`
                : 'colocando…'}
        </li>
      ))}
    </ul>
  );

  const head = (
    <>
      <div className="panel-head">
        <h3>🤝 Negociación</h3>
        <Countdown deadline={n.deadline} />
      </div>
      <p className="hint">{describeSlots(n.slots, nameOf)}.</p>
    </>
  );

  if (!amIn) {
    return (
      <>
        {head}
        <p>{joinNames(n.players.map(nameOf))} están negociando dónde colocar sus fichas.</p>
        {status}
      </>
    );
  }

  return (
    <>
      {head}
      <p className="hint">
        Elige tus fichas y colócalas; las de {joinNames(others.map(nameOf))} te salen en dorado según las ponen. Cuando
        os guste a todos, pulsad «Estoy de acuerdo».
      </p>
      {mySlots.map(({ sl, j }) => (
        <SlotPicker key={j} n={n} slotIndex={j} auction={sl.auction} pick={sl.pick} nameOf={nameOf} round={g.round} />
      ))}

      {draft.tokens.length > 0 && (
        <>
          <h3>Tus fichas</h3>
          <div className="tray-tokens" role="listbox" aria-label="Tus fichas por colocar">
            {draft.tokens.map((c, i) => {
              const used = draft.used.has(i);
              const firstFree = draft.tokens.findIndex((_, k) => !draft.used.has(k));
              const selected = !used && (draft.selected === i || (draft.selected === null && firstFree === i));
              return (
                <button
                  key={i}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`tray-token${selected ? ' selected' : ''}${used ? ' used' : ''}`}
                  onClick={() => draft.select(i)}
                  disabled={used}
                >
                  <Token color={c} size={42} />
                </button>
              );
            })}
          </div>
          <p className="hint">Toca una casilla libre para poner la ficha marcada; toca una tuya para quitarla.</p>
        </>
      )}
      {status}
      <div className="row-buttons">
        <button
          className="btn primary"
          disabled={!n.players.every(complete) || n.agreed[me]}
          onClick={() => act({ type: 'negAgree' })}
        >
          {n.agreed[me] ? '✓ De acuerdo' : '✓ Estoy de acuerdo'}
        </button>
        <button
          className="btn ghost small danger"
          onClick={() =>
            confirm('Sin acuerdo, la ronda es nula y todos los ganadores perdéis la puja. ¿Seguro?') && act({ type: 'negNoDeal' })
          }
        >
          Declarar sin acuerdo
        </button>
      </div>
    </>
  );
}

/** Elegir mis fichas de una subasta; las ya cogidas por otra persona salen apagadas. */
function SlotPicker(props: {
  n: NonNullable<GameView['negotiation']>;
  slotIndex: number;
  auction: AuctionId;
  pick: number;
  nameOf: NameOf;
  round: number;
}) {
  const { n, slotIndex, auction, pick, nameOf, round } = props;
  const current = n.picks![slotIndex];
  const [sel, setSel] = useState<number[]>(current ?? []);
  useEffect(() => setSel(current ?? []), [round, current?.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const takenBy = new Map<number, string>();
  n.slots.forEach((sl, j) => {
    if (j !== slotIndex && sl.auction === auction) for (const i of n.picks![j] ?? []) takenBy.set(i, sl.playerId);
  });
  if (pick === 0) return <p className="hint">Sois demasiados empatados en la {auction}: esta vez no te toca ficha.</p>;
  return (
    <div className="slot-picker">
      <div className="muted small">
        Elige {pick} {pick === 1 ? 'ficha' : 'fichas'} de la subasta {auction}:
      </div>
      <div className="neg-pick" role="group" aria-label={`Fichas de la subasta ${auction}`}>
        {n.pools[auction]!.map((c, i) => {
          const on = sel.includes(i);
          const owner = takenBy.get(i);
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              disabled={!!owner}
              title={owner ? `La ha elegido ${nameOf(owner)}` : undefined}
              className={`tray-token${on ? ' selected' : ''}${owner ? ' used' : ''}`}
              onClick={() => setSel(on ? sel.filter((x) => x !== i) : sel.length < pick ? [...sel, i] : sel)}
            >
              <Token color={c} size={40} />
            </button>
          );
        })}
      </div>
      <button
        className="btn small"
        disabled={sel.length !== pick || sel.slice().sort().join() === (current ?? []).join()}
        onClick={() => act({ type: 'negPick', auction, indices: sel })}
      >
        {current ? 'Cambiar elección' : 'Confirmar elección'}
      </button>
    </div>
  );
}

function ClosedPanel({ view, g, nameOf }: PanelProps) {
  const last = g.log.at(-1);
  const isLast = g.round >= g.totalRounds;
  return (
    <>
      <h3>Ronda {g.round} cerrada</h3>
      {last && last.round === g.round && last.type !== 'resolution' && <p className="log-line">{logText(last, nameOf)}</p>}
      {view.me.isHost ? (
        <button className="btn primary" onClick={() => act({ type: 'next' })}>
          {isLast ? '🏁 Ver resultados' : '➡️ Siguiente ronda'}
        </button>
      ) : (
        <p className="hint">Esperando al anfitrión…</p>
      )}
    </>
  );
}

function FinalPanel({ view, g, nameOf, finalHighlight, setFinalHighlight }: PanelProps) {
  const res = g.results!;
  return (
    <>
      <h2 className="final-title">🏆 {res.winners.length > 1 ? '¡Empate!' : '¡Fin de la partida!'}</h2>
      <p className="final-winners">
        {res.winners.length > 1 ? 'Ganan' : 'Gana'} <b>{joinNames(res.winners.map(nameOf))}</b>
      </p>
      <ol className="ranking">
        {res.ranking.map((r, i) => {
          const win = res.winners.includes(r.playerId);
          return (
            <li key={r.playerId} className={`${win ? 'winner' : ''}${finalHighlight === r.playerId ? ' active' : ''}`}>
              <button className="ranking-btn" onClick={() => setFinalHighlight(r.playerId)} aria-pressed={finalHighlight === r.playerId}>
                <span className="rank">{win ? '👑' : i + 1}</span>
                <span className="ranking-name">{nameOf(r.playerId)}</span>
                <TokenRow tokens={r.combo} size={26} />
                <span className="ranking-count">{r.count}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="hint">Toca un jugador para resaltar sus apariciones en el tablero.</p>
      {view.me.isHost ? (
        <div className="row-buttons">
          <button className="btn primary" onClick={() => call('game:restart', {})}>
            🔁 Nueva partida con los mismos jugadores
          </button>
          <button className="btn ghost danger" onClick={() => confirm('¿Cerrar la sala para todos?') && call('room:close', {})}>
            Cerrar sala
          </button>
        </div>
      ) : (
        <button className="btn ghost small" onClick={forgetSession}>
          Salir
        </button>
      )}
    </>
  );
}

// ───────────────────────── jugadores e historial ─────────────────────────

function Players({ view, g }: { view: ClientView; g: GameView }) {
  const [editing, setEditing] = useState<string | null>(null);
  const canEdit = view.me.isHost && g.phase !== 'FIN';
  return (
    <section className="card">
      <h3>Jugadores</h3>
      <ul className="member-list compact">
        {view.members.map((m) => {
          const final = g.results?.ranking.find((r) => r.playerId === m.id);
          return (
            <li key={m.id} className={m.connected ? '' : 'offline'}>
              <span className={`dot ${m.connected ? 'on' : 'off'}`} aria-label={m.connected ? 'Conectado' : 'Desconectado'} />
              <span className="member-name">
                {m.isHost && '👑 '}
                {m.name}
                {m.id === view.me.id && <span className="muted"> (tú)</span>}
              </span>
              {g.phase === 'PUJAS_ABIERTAS' && m.inGame && (
                <span className={`bid-flag${m.hasBid ? ' yes' : ''}`}>{m.hasBid ? '✓ ha enviado' : '…'}</span>
              )}
              {final && <span className="badge">{final.count} ✦</span>}
              {m.inGame ? (
                editing === m.id ? (
                  <CoinEditor
                    current={m.coins ?? 0}
                    onDone={async (coins) => {
                      if (coins === null || (await act({ type: 'setCoins', playerId: m.id, coins }))) setEditing(null);
                    }}
                  />
                ) : (
                  <>
                    <span className="coins-tag">🪙 {m.coins}</span>
                    {canEdit && (
                      <button
                        className="btn ghost small coin-edit"
                        onClick={() => setEditing(m.id)}
                        aria-label={`Cambiar monedas de ${m.name}`}
                        title="Añadir o quitar monedas"
                      >
                        ±
                      </button>
                    )}
                  </>
                )
              ) : (
                <span className="muted small">anfitrión</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CoinEditor({ current, onDone }: { current: number; onDone: (coins: number | null) => void }) {
  const [value, setValue] = useState(String(current));
  const n = Math.max(0, Math.floor(Number(value) || 0));
  const step = (d: number) => setValue(String(Math.max(0, n + d)));
  return (
    <form
      className="coin-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(n);
      }}
    >
      <button type="button" className="btn ghost small" onClick={() => step(-5)}>
        −5
      </button>
      <button type="button" className="btn ghost small" onClick={() => step(-1)}>
        −1
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Monedas"
        autoFocus
      />
      <button type="button" className="btn ghost small" onClick={() => step(1)}>
        +1
      </button>
      <button type="button" className="btn ghost small" onClick={() => step(5)}>
        +5
      </button>
      <button type="submit" className="btn primary small">
        Guardar
      </button>
      <button type="button" className="btn ghost small" onClick={() => onDone(null)} aria-label="Cancelar">
        ✕
      </button>
    </form>
  );
}

/** Controles extra del anfitrión durante la partida. */
function HostTools() {
  return (
    <details className="card host-tools">
      <summary>⚙️ Controles del anfitrión</summary>
      <p className="hint">Usa el botón ± de la lista de jugadores para añadir o quitar monedas.</p>
      <div className="row-buttons">
        <button
          className="btn ghost"
          onClick={() =>
            confirm('¿Terminar la partida ahora? Se contarán las apariciones con el tablero tal y como está.') &&
            act({ type: 'endNow' })
          }
        >
          🏁 Terminar partida ahora
        </button>
        <button
          className="btn ghost danger"
          onClick={() => confirm('¿Cerrar la sala? Se echará a todos y se perderá la partida.') && call('room:close', {})}
        >
          ✖ Cerrar sala
        </button>
      </div>
    </details>
  );
}

function History({ g, nameOf }: { g: GameView; nameOf: NameOf }) {
  if (g.log.length === 0) return null;
  return (
    <details className="card history" open>
      <summary>Historial de jugadas</summary>
      <ol reversed>
        {[...g.log].reverse().map((e, i) => (
          <li key={g.log.length - i} className={`log-${e.type}`}>
            <span className="log-round">R{e.round}</span> {logText(e, nameOf)}
          </li>
        ))}
      </ol>
    </details>
  );
}

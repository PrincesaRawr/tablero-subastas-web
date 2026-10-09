import { useEffect, useMemo, useState } from 'react';
import { NEGOTIATION_PICK, type Color } from '../../../shared/config';
import { applyPlacements, findOccurrences, type Cell } from '../../../shared/engine';
import type { ClientView } from '../../../shared/view';
import { act, call, forgetSession } from '../store';
import { PHASE_LABEL, joinNames, logText, nameResolver, resolutionVerdict, winnerLine, type NameOf } from '../text';
import { usePlacementDraft, type PlacementDraft } from '../usePlacementDraft';
import { Board } from './Board';
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

  const [comboVisible, setComboVisible] = useState(() => readPref('ts:combo-visible', true));
  const [highlightMine, setHighlightMine] = useState(false);
  const [finalHighlight, setFinalHighlight] = useState<string | null>(null);

  // ── colocación normal ──
  const placingMe = g.phase === 'COLOCACION' && g.placement?.playerId === me.id;
  const placeTokens = placingMe ? g.placement!.tokens : NO_TOKENS;
  const placeDraft = usePlacementDraft(placeTokens, `${g.round}-${placingMe}`);

  // ── negociación ──
  const neg = g.negotiation;
  const amNegotiator = !!neg?.picks;
  const bothReady = !!neg && neg.players.every((p) => neg.ready[p]);
  const sixTokens = useMemo<Color[]>(
    () => (amNegotiator && bothReady ? neg!.players.flatMap((p) => neg!.picks![p]!.map((i) => neg!.tokens[p][i])) : NO_TOKENS),
    [amNegotiator, bothReady, neg],
  );
  const [counter, setCounter] = useState(false);
  useEffect(() => setCounter(false), [neg?.proposalBy, neg?.hasProposal, g.round]);
  const drafting = amNegotiator && bothReady && (!neg!.hasProposal || counter);
  const negDraft = usePlacementDraft(sixTokens, `${g.round}-${sixTokens.join()}`);

  // ── tablero: fichas provisionales, clic y resaltado ──
  let ghosts = placingMe ? placeDraft.placements : [];
  let ghostKind: 'draft' | 'proposal' = 'draft';
  let onCellClick: ((c: Cell) => void) | undefined = placingMe ? placeDraft.clickCell : undefined;
  if (amNegotiator) {
    if (drafting) {
      ghosts = negDraft.placements;
      onCellClick = negDraft.clickCell;
    } else if (neg!.proposal) {
      ghosts = neg!.proposal;
      ghostKind = 'proposal';
    }
  }

  const myOccurrences = useMemo(() => (me.combo ? findOccurrences(g.board, me.combo) : []), [g.board, me.combo]);
  const previewCount = useMemo(
    () => (me.combo && ghosts.length ? findOccurrences(applyPlacements(g.board, ghosts), me.combo).length : null),
    [g.board, ghosts, me.combo],
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
          <Board board={g.board} ghosts={ghosts} ghostKind={ghostKind} highlights={highlights} recent={recent} onCellClick={onCellClick} />

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
            negDraft={negDraft}
            sixTokens={sixTokens}
            drafting={drafting}
            onCounter={() => setCounter(true)}
            finalHighlight={finalHighlight ?? g.results?.winners[0] ?? null}
            setFinalHighlight={setFinalHighlight}
          />
          <Players view={view} g={g} />
          <History g={g} nameOf={nameOf} />
        </aside>
      </div>
    </main>
  );
}

const NO_TOKENS: Color[] = [];

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
  negDraft: PlacementDraft;
  sixTokens: Color[];
  drafting: boolean;
  onCounter: () => void;
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
          <p className="hint">0 = no participas en esa subasta. Es secreta: nadie ve las cantidades.</p>
          <div className="row-buttons">
            <button className="btn primary" type="submit" disabled={over || !changed || coins === 0}>
              {me.bid ? 'Actualizar puja' : 'Enviar puja'}
            </button>
            {me.bid && (
              <button className="btn ghost small" type="button" onClick={() => act({ type: 'bid', bid: { A: 0, B: 0 } })}>
                Retirar puja
              </button>
            )}
          </div>
          {me.bid && (
            <p className="sent">
              ✓ Puja enviada: A {me.bid.A} · B {me.bid.B}
            </p>
          )}
          {coins === 0 && <p className="hint">No te quedan monedas: esta ronda solo puedes mirar.</p>}
        </form>
      )}
      <p className="muted small">
        Han pujado {bidders} de {players.length}
      </p>
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

function Reveal({ g, nameOf }: { g: GameView; nameOf: NameOf }) {
  const r = g.resolution!;
  return (
    <div className="reveal" key={g.round}>
      <h2>Resultado de la subasta</h2>
      <ul className="reveal-list">
        {(['A', 'B'] as const).map((id, i) => (
          <li key={id} className={`reveal-item${r.recipient?.auction === id ? ' won' : ''}`} style={{ animationDelay: `${i * 350}ms` }}>
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
  const winner = g.resolution!.winners.A!.playerId;
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

function NegotiationPanel({ view, g, nameOf, negDraft, sixTokens, drafting, onCounter }: PanelProps) {
  const n = g.negotiation!;
  const me = view.me.id;
  const amIn = !!n.picks;
  const other = n.players.find((p) => p !== me)!;
  const [sel, setSel] = useState<number[]>([]);
  useEffect(() => setSel(n.picks?.[me] ?? []), [g.round, n.picks?.[me]?.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = (
    <ul className="neg-status">
      {n.players.map((p) => (
        <li key={p}>
          {nameOf(p)}: {n.ready[p] ? '✓ fichas elegidas' : 'eligiendo fichas…'}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <div className="panel-head">
        <h3>🤝 Negociación</h3>
        <Countdown deadline={n.deadline} />
      </div>
      {!amIn ? (
        <>
          <p>
            {joinNames(n.players.map(nameOf))} están negociando cómo colocar 6 fichas.
          </p>
          {status}
          {n.hasProposal && <p className="muted">Hay una propuesta de {nameOf(n.proposalBy!)} sobre la mesa.</p>}
        </>
      ) : (
        <>
          <p className="hint">
            Elige {NEGOTIATION_PICK} de tus 5 fichas. Después, cualquiera de los dos puede proponer dónde van las 6.
          </p>
          <div className="neg-pick" role="group" aria-label="Tus fichas">
            {n.tokens[me].map((c, i) => {
              const on = sel.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  className={`tray-token${on ? ' selected' : ''}`}
                  onClick={() => setSel(on ? sel.filter((x) => x !== i) : sel.length < NEGOTIATION_PICK ? [...sel, i] : sel)}
                >
                  <Token color={c} size={42} />
                </button>
              );
            })}
          </div>
          <button
            className="btn small"
            disabled={sel.length !== NEGOTIATION_PICK || sel.slice().sort().join() === (n.picks![me] ?? []).join()}
            onClick={() => act({ type: 'negPick', indices: sel })}
          >
            {n.picks![me] ? 'Cambiar elección' : 'Confirmar elección'}
          </button>
          <div className="muted small">Fichas de {nameOf(other)}:</div>
          <TokenRow
            tokens={n.picks![other] ? n.picks![other]!.map((i) => n.tokens[other][i]) : n.tokens[other]}
            size={30}
          />
          {status}

          {drafting && (
            <>
              <h3>Tu propuesta</h3>
              <DraftTray tokens={sixTokens} draft={negDraft} />
              <button
                className="btn primary wide"
                disabled={!negDraft.complete}
                onClick={() => act({ type: 'negPropose', placements: negDraft.placements })}
              >
                📨 Enviar propuesta
              </button>
            </>
          )}
          {!drafting && n.hasProposal && n.proposalBy === me && (
            <>
              <p>Propuesta enviada (en el tablero). Esperando respuesta de {nameOf(other)}…</p>
              <button className="btn ghost small" onClick={onCounter}>
                ✏️ Cambiar propuesta
              </button>
            </>
          )}
          {!drafting && n.hasProposal && n.proposalBy === other && (
            <>
              <p>
                <b>{nameOf(other)}</b> propone la colocación que ves en el tablero.
              </p>
              <div className="row-buttons">
                <button className="btn primary" onClick={() => act({ type: 'negAccept' })}>
                  ✓ Aceptar
                </button>
                <button
                  className="btn ghost"
                  onClick={async () => {
                    if (await act({ type: 'negReject' })) onCounter();
                  }}
                >
                  ✗ Rechazar y contraproponer
                </button>
              </div>
            </>
          )}
          {n.rejectedBy === other && !n.hasProposal && <p className="muted">{nameOf(other)} rechazó la propuesta.</p>}
          <button
            className="btn ghost small danger"
            onClick={() => confirm('Sin acuerdo, la ronda es nula y los dos perdéis la puja. ¿Seguro?') && act({ type: 'negNoDeal' })}
          >
            Declarar sin acuerdo
          </button>
        </>
      )}
    </>
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
                <span className={`bid-flag${m.hasBid ? ' yes' : ''}`}>{m.hasBid ? '✓ ha pujado' : '…'}</span>
              )}
              {final && <span className="badge">{final.count} ✦</span>}
              {m.inGame ? <span className="coins-tag">🪙 {m.coins}</span> : <span className="muted small">anfitrión</span>}
            </li>
          );
        })}
      </ul>
    </section>
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

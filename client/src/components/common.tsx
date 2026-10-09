import { useEffect, useRef, useState, type ReactNode } from 'react';
import { STARTING_COINS, TOTAL_ROUNDS, NEGOTIATION_TIME_LIMIT_S, type Color } from '../../../shared/config';
import { serverNow } from '../store';
import type { PlacementDraft } from '../usePlacementDraft';
import { Token } from './Token';

export function Countdown({ deadline, label }: { deadline: number | null; label?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  const left = Math.max(0, Math.ceil((deadline - serverNow()) / 1000));
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  return (
    <span className={`countdown${left <= 10 ? ' urgent' : ''}`} role="timer" aria-live="off">
      ⏱ {label ? `${label} ` : ''}
      {mm}:{ss}
    </span>
  );
}

export function TokenRow({ tokens, size = 40, label }: { tokens: Color[]; size?: number; label?: string }) {
  return (
    <div className="token-row" aria-label={label}>
      {tokens.map((c, i) => (
        <Token key={i} color={c} size={size} />
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Cómo se juega" onClose={onClose}>
      <div className="rules">
        <p>
          Tablero compartido de 8×8 (columnas <b>A–H</b>, filas <b>1–8</b>). Cada jugador recibe en secreto una{' '}
          <b>combinación de 3 colores</b> y empieza con <b>{STARTING_COINS} monedas</b>. Hay <b>{TOTAL_ROUNDS} rondas</b>.
        </p>
        <h3>🎯 Objetivo</h3>
        <p>
          Que tu combinación aparezca el mayor número de veces al final: en horizontal, vertical o diagonal, y se puede leer
          al revés, pero siempre respetando el orden.
        </p>
        <h3>🔨 Cada ronda</h3>
        <ol>
          <li>Hay dos subastas, <b>A</b> y <b>B</b>, con 5 fichas cada una.</li>
          <li>Pujas en secreto en A, en B, en las dos o en ninguna. Puedes cambiar tu puja mientras esté abierta.</li>
          <li>Gana cada subasta quien más pujó.</li>
          <li>
            <b>El giro:</b> de los dos ganadores, solo se lleva las fichas <b>el que pujó MENOS</b>. Las otras fichas se
            eliminan.
          </li>
        </ol>
        <div className="example">
          <b>Ejemplo:</b> Ana gana A con <b>15</b> monedas y Luis gana B con <b>17</b>. Ana coloca sus 5 fichas; las de B se
          descartan. Ana pierde 15 monedas y Luis pierde 17. Todos los demás recuperan lo que pujaron.
        </div>
        <h3>🤝 Empate</h3>
        <p>
          Si los dos ganadores pujaron lo mismo, negocian: cada uno elige 3 de sus 5 fichas y se ponen de acuerdo para
          colocar las 6. Si no hay acuerdo (o pasan {NEGOTIATION_TIME_LIMIT_S / 60} minutos), la ronda es nula y los dos
          pierden lo pujado.
        </p>
        <h3>🪙 Monedas</h3>
        <p>Los dos ganadores pierden lo que pujaron, se lleven fichas o no. El resto lo recupera todo.</p>
        <h3>👑 Final</h3>
        <p>Tras la ronda {TOTAL_ROUNDS} se revelan las combinaciones. Gana quien más apariciones tenga.</p>
      </div>
    </Modal>
  );
}

/** Bandeja de fichas por colocar + botones deshacer/limpiar. */
export function DraftTray({ tokens, draft }: { tokens: Color[]; draft: PlacementDraft }) {
  return (
    <div className="tray">
      <div className="tray-tokens" role="listbox" aria-label="Fichas por colocar">
        {tokens.map((c, i) => {
          const used = draft.isUsed(i);
          return (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={draft.selected === i}
              className={`tray-token${draft.selected === i ? ' selected' : ''}${used ? ' used' : ''}`}
              onClick={() => draft.select(i)}
              disabled={used}
            >
              <Token color={c} size={44} />
            </button>
          );
        })}
      </div>
      <p className="hint">
        {draft.complete
          ? '¡Todas colocadas! Toca una ficha del tablero para quitarla.'
          : 'Elige una ficha y toca una casilla libre del tablero.'}
      </p>
      <div className="row-buttons">
        <button className="btn ghost small" onClick={draft.undo} disabled={draft.placements.length === 0}>
          ↶ Deshacer
        </button>
        <button className="btn ghost small" onClick={draft.clear} disabled={draft.placements.length === 0}>
          Limpiar
        </button>
      </div>
    </div>
  );
}

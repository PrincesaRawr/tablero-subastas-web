import { useState } from 'react';
import {
  AUTO_CLOSE_AFTER_ALL_BIDS_S,
  AUTO_DEAL_DELAY_S,
  AUTO_NEXT_DELAY_S,
  AUTO_OPEN_DELAY_S,
  BAG_PER_COLOR,
  MAX_COINS,
  MAX_PLAYERS,
  MAX_TIMER_S,
  MIN_PLAYERS,
  NEGOTIATION_TIME_LIMIT_S,
  TOTAL_ROUNDS,
} from '../../../shared/config';
import type { ClientView } from '../../../shared/view';
import { call, forgetSession, showToast } from '../store';

export function Lobby({ view, onRules }: { view: ClientView; onRules: () => void }) {
  const { me } = view;
  const playing = view.members.filter((m) => m.isPlaying);
  const canStart = playing.length >= MIN_PLAYERS && playing.length <= MAX_PLAYERS;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(view.code);
      showToast('Código copiado', 'info');
    } catch {
      showToast(`El código es ${view.code}`, 'info');
    }
  };

  return (
    <main className="lobby">
      <section className="card lobby-code">
        <p>Código de la sala</p>
        <button className="room-code" onClick={copy} title="Copiar código">
          {view.code}
        </button>
        <p className="hint">Compártelo por Discord para que se unan.</p>
      </section>

      <section className="card">
        <h2>
          Jugadores <span className="muted">({playing.length}/{MAX_PLAYERS})</span>
        </h2>
        <ul className="member-list">
          {view.members.map((m) => (
            <li key={m.id} className={m.connected ? '' : 'offline'}>
              <span className={`dot ${m.connected ? 'on' : 'off'}`} aria-label={m.connected ? 'Conectado' : 'Desconectado'} />
              <span className="member-name">
                {m.name}
                {m.id === me.id && <span className="muted"> (tú)</span>}
              </span>
              {m.isHost && <span className="badge">👑 Anfitrión{m.isPlaying ? '' : ' · no juega'}</span>}
              {me.isHost && !m.isHost && (
                <button className="btn ghost small danger" onClick={() => call('room:kick', { memberId: m.id })}>
                  Expulsar
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <GameSettingsSummary view={view} />
      {me.isHost ? (
        <HostLobbyControls view={view} canStart={canStart} />
      ) : (
        <section className="card center">
          <p>Esperando a que el anfitrión empiece la partida…</p>
          <button
            className="btn ghost small"
            onClick={async () => (await call('room:leave', {})) && forgetSession()}
          >
            Salir de la sala
          </button>
        </section>
      )}
      <button className="btn ghost" onClick={onRules}>
        📖 Cómo se juega
      </button>
    </main>
  );
}

function HostLobbyControls({ view, canStart }: { view: ClientView; canStart: boolean }) {
  const [auction, setAuction] = useState(String(view.settings.auctionTimerS));
  const [placement, setPlacement] = useState(String(view.settings.placementTimerS));
  const [coins, setCoins] = useState(String(view.settings.startingCoins));
  const save = async (startingCoins = Number(coins), autoAdvance = !!view.settings.autoAdvance) => {
    const res = await call('room:settings', {
      auctionTimerS: Number(auction) || 0,
      placementTimerS: Number(placement) || 0,
      startingCoins: Math.round(startingCoins) || 0,
      autoAdvance,
    });
    if (!res) setCoins(String(view.settings.startingCoins)); // valor no válido: vuelve al anterior
  };
  const pickCoins = (n: number) => {
    setCoins(String(n));
    save(n);
  };

  return (
    <section className="card">
      <h2>Opciones del anfitrión</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={view.me.isPlaying}
          onChange={(e) => call('room:setPlaying', { playing: e.target.checked })}
        />
        Yo también juego
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={!!view.settings.autoAdvance}
          onChange={(e) => save(Number(coins), e.target.checked)}
        />
        ⏩ Modo automático (sacar fichas, abrir subasta y pasar de ronda solo)
      </label>
      <label className="field">
        <span>🪙 Monedas con las que empieza cada jugador</span>
        <div className="coin-presets">
          {[20, 30, 40, 50, 60, 100].map((n) => (
            <button
              key={n}
              type="button"
              className={`btn small ${view.settings.startingCoins === n ? 'primary' : 'ghost'}`}
              onClick={() => pickCoins(n)}
              aria-pressed={view.settings.startingCoins === n}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={MAX_COINS}
            value={coins}
            onChange={(e) => setCoins(e.target.value)}
            onBlur={() => save()}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            aria-label="Otra cantidad de monedas"
          />
        </div>
      </label>
      <div className="settings-grid">
        <label className="field">
          <span>Tiempo para pujar (s)</span>
          <input type="number" min={0} max={MAX_TIMER_S} value={auction} onChange={(e) => setAuction(e.target.value)} onBlur={() => save()} />
        </label>
        <label className="field">
          <span>Tiempo para colocar (s)</span>
          <input
            type="number"
            min={0}
            max={MAX_TIMER_S}
            value={placement}
            onChange={(e) => setPlacement(e.target.value)}
            onBlur={() => save()}
          />
        </label>
      </div>
      <p className="hint">0 = sin límite. Si se agota el tiempo de colocación, las fichas se colocan al azar.</p>
      <div className="row-buttons">
        <button className="btn primary" disabled={!canStart} onClick={() => call('game:start', {})}>
          Empezar partida
        </button>
        <button
          className="btn ghost danger"
          onClick={() => confirm('¿Cerrar la sala para todos?') && call('room:close', {})}
        >
          Cerrar sala
        </button>
      </div>
      {!canStart && <p className="hint">Hacen falta al menos {MIN_PLAYERS} jugadores.</p>}
    </section>
  );
}

/** Resumen de la configuración, visible para todos los que esperan en la sala. */
function GameSettingsSummary({ view }: { view: ClientView }) {
  const st = view.settings;
  const secs = (n: number) => (n > 0 ? (n >= 60 && n % 60 === 0 ? `${n / 60} min` : `${n} s`) : 'sin límite');
  const rows: [string, string, string][] = [
    ['🪙', 'Monedas iniciales', String(st.startingCoins)],
    ['🔁', 'Rondas', String(TOTAL_ROUNDS)],
    ['🎒', 'Sacos', `${BAG_PER_COLOR} fichas de cada color por saco`],
    ['🔨', 'Tiempo para pujar', secs(st.auctionTimerS)],
    ['🔔', 'Cierre de la subasta', `sola a los ${AUTO_CLOSE_AFTER_ALL_BIDS_S} s de que pujen todos`],
    ['🧩', 'Tiempo para colocar', st.placementTimerS > 0 ? `${secs(st.placementTimerS)} (después, al azar)` : 'sin límite'],
    ['🤝', 'Tiempo para negociar', secs(NEGOTIATION_TIME_LIMIT_S)],
    [
      '⏩',
      'Modo automático',
      st.autoAdvance
        ? `sí (fichas: ${AUTO_DEAL_DELAY_S} s · subasta: ${AUTO_OPEN_DELAY_S} s · siguiente ronda: ${AUTO_NEXT_DELAY_S} s)`
        : 'no (el anfitrión avanza a mano)',
    ],
  ];
  return (
    <section className="card settings-summary" aria-label="Configuración de la partida">
      <h2>⚙️ Cómo está configurada la partida</h2>
      <dl>
        {rows.map(([icon, label, value]) => (
          <div className="summary-row" key={label}>
            <dt>
              <span aria-hidden="true">{icon}</span> {label}
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {!view.me.isHost && <p className="hint">Lo elige el anfitrión; si lo cambia, se actualiza aquí al momento.</p>}
    </section>
  );
}

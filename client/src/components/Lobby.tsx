import { useState } from 'react';
import { MAX_PLAYERS, MAX_TIMER_S, MIN_PLAYERS } from '../../../shared/config';
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
  const save = () =>
    call('room:settings', { auctionTimerS: Number(auction) || 0, placementTimerS: Number(placement) || 0 });

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
      <div className="settings-grid">
        <label className="field">
          <span>Tiempo para pujar (s)</span>
          <input type="number" min={0} max={MAX_TIMER_S} value={auction} onChange={(e) => setAuction(e.target.value)} onBlur={save} />
        </label>
        <label className="field">
          <span>Tiempo para colocar (s)</span>
          <input
            type="number"
            min={0}
            max={MAX_TIMER_S}
            value={placement}
            onChange={(e) => setPlacement(e.target.value)}
            onBlur={save}
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

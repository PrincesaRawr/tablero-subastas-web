import { useState } from 'react';
import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH, COLORS } from '../../../shared/config';
import { call } from '../store';
import { Token } from './Token';

export function Home({ onRules }: { onRules: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [playing, setPlaying] = useState(true);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };

  return (
    <main className="home">
      <header className="home-title">
        <div className="home-tokens" aria-hidden="true">
          {COLORS.map((c, i) => (
            <Token key={c} color={c} size={52} noSymbol className="float" title="" />
          ))}
        </div>
        <h1>Tablero de Subastas</h1>
        <p className="subtitle">Puja, engaña y forma tu combinación secreta ✦</p>
      </header>

      <section className="card home-card">
        <label className="field">
          <span>Tu nombre</span>
          <input
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            placeholder="Princesa Gatuna"
            autoComplete="nickname"
          />
        </label>

        <div className="home-actions">
          <div className="home-box">
            <h2>Crear sala</h2>
            <label className="check">
              <input type="checkbox" checked={playing} onChange={(e) => setPlaying(e.target.checked)} />
              Yo también juego
            </label>
            <button
              className="btn primary"
              disabled={busy || !name.trim()}
              onClick={() => run(() => call('room:create', { name, playing }))}
            >
              Crear sala
            </button>
          </div>
          <div className="home-or" aria-hidden="true">
            o
          </div>
          <form
            className="home-box"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => call('room:join', { code, name }));
            }}
          >
            <h2>Unirse</h2>
            <input
              className="code-input"
              value={code}
              maxLength={ROOM_CODE_LENGTH}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              placeholder="CÓDIGO"
              aria-label="Código de sala"
              autoCapitalize="characters"
            />
            <button className="btn" type="submit" disabled={busy || !name.trim() || code.length !== ROOM_CODE_LENGTH}>
              Unirse con código
            </button>
          </form>
        </div>
      </section>
      <button className="btn ghost" onClick={onRules}>
        📖 Cómo se juega
      </button>
    </main>
  );
}

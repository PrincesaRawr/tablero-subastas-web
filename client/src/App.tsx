import { useState } from 'react';
import { RulesModal } from './components/common';
import { Game } from './components/Game';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { TokenSprite } from './components/Token';
import { dismissToast, useStore } from './store';

export function App() {
  const { view, connected, toast, resuming } = useStore();
  const [rules, setRules] = useState(false);
  const openRules = () => setRules(true);

  let screen;
  if (view?.game) screen = <Game view={view} onRules={openRules} />;
  else if (view) screen = <Lobby view={view} onRules={openRules} />;
  else if (resuming) screen = <p className="loading">Recuperando tu partida…</p>;
  else screen = <Home onRules={openRules} />;

  return (
    <>
      <TokenSprite />
      <div className="sky" aria-hidden="true" />
      {!connected && <div className="offline-banner">Sin conexión con el servidor. Reconectando…</div>}
      {screen}
      {rules && <RulesModal onClose={() => setRules(false)} startingCoins={view?.settings.startingCoins} />}
      {toast && (
        <div className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} onClick={dismissToast}>
          {toast.text}
        </div>
      )}
    </>
  );
}

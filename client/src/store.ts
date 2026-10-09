/**
 * Conexión con el servidor y estado global del cliente.
 * El cliente nunca decide resultados: solo envía intenciones y pinta la vista que recibe.
 */
import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '../../shared/protocol';
import type { ClientView } from '../../shared/view';

const TOKEN_KEY = 'tablero-subastas:token';

interface State {
  connected: boolean;
  view: ClientView | null;
  /** Diferencia reloj servidor - reloj local, para los temporizadores. */
  clockOffset: number;
  toast: { text: string; kind: 'error' | 'info'; id: number } | null;
  resuming: boolean;
}

let state: State = { connected: false, view: null, clockOffset: 0, toast: null, resuming: !!readToken() };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useStore(): State {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* almacenamiento no disponible: la reconexión no funcionará, pero se puede jugar */
  }
}

export const socket: Socket<ServerToClient, ClientToServer> = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  set({ connected: true });
  const token = readToken();
  if (token) {
    set({ resuming: true });
    socket.emit('room:resume', { token }, (res) => {
      if (!res.ok) {
        writeToken(null);
        set({ view: null });
      }
      set({ resuming: false });
    });
  }
});
socket.on('disconnect', () => set({ connected: false }));
socket.on('state', (view) => set({ view, clockOffset: view.serverNow - Date.now() }));
socket.on('kicked', () => {
  writeToken(null);
  set({ view: null });
  showToast('El anfitrión te ha expulsado de la sala.', 'info');
});
socket.on('room:closed', () => {
  writeToken(null);
  set({ view: null });
  showToast('La sala se ha cerrado.', 'info');
});

let toastId = 0;
export function showToast(text: string, kind: 'error' | 'info' = 'error') {
  const id = ++toastId;
  set({ toast: { text, kind, id } });
  setTimeout(() => state.toast?.id === id && set({ toast: null }), 4500);
}
export const dismissToast = () => set({ toast: null });

type Payload<E extends keyof ClientToServer> = Parameters<ClientToServer[E]>[0];

/** Envía una petición y muestra el error si la hay. Devuelve la respuesta o null. */
export function call<E extends keyof ClientToServer>(event: E, payload: Payload<E>): Promise<any | null> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      showToast('Sin conexión con el servidor. Reintentando…');
      return resolve(null);
    }
    (socket.timeout(8000) as any).emit(event, payload, (err: unknown, res: any) => {
      if (err) {
        showToast('El servidor no responde. Inténtalo de nuevo.');
        return resolve(null);
      }
      if (!res.ok) {
        showToast(res.error);
        return resolve(null);
      }
      if (res.token) writeToken(res.token);
      resolve(res);
    });
  });
}

export const act = (action: Payload<'game:action'>) => call('game:action', action);

export function forgetSession() {
  writeToken(null);
  set({ view: null });
}

export function serverNow(): number {
  return Date.now() + state.clockOffset;
}

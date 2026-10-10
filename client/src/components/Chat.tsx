import { useEffect, useMemo, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH } from '../../../shared/config';
import type { ChatMessage, ClientView } from '../../../shared/view';
import { call } from '../store';

/** Pestaña: 'general' o el id de la otra persona (chat privado). */
type Tab = string;
const GENERAL = 'general';

const threadOf = (m: ChatMessage, me: string): Tab => (m.to === null ? GENERAL : m.from === me ? m.to : m.from);

/**
 * Chat de la partida: un chat general y uno privado con cada persona.
 * Solo existe durante la partida; el servidor lo borra al terminar.
 */
export function Chat({ view }: { view: ClientView }) {
  const me = view.me.id;
  const others = view.members.filter((m) => m.id !== me);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(GENERAL);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // último mensaje visto en cada pestaña (para los avisos de "sin leer")
  const [seen, setSeen] = useState<Record<Tab, number>>({});
  const listRef = useRef<HTMLOListElement>(null);

  const byThread = useMemo(() => {
    const map = new Map<Tab, ChatMessage[]>();
    for (const m of view.chat) {
      const t = threadOf(m, me);
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(m);
    }
    return map;
  }, [view.chat, me]);

  const unread = (t: Tab) =>
    (byThread.get(t) ?? []).filter((m) => m.from !== me && m.id > (seen[t] ?? 0)).length;
  const tabs: Tab[] = [GENERAL, ...others.map((o) => o.id)];
  const totalUnread = tabs.reduce((a, t) => a + unread(t), 0);

  // Si la pestaña es de alguien que ya no está, vuelve al general.
  useEffect(() => {
    if (tab !== GENERAL && !others.some((o) => o.id === tab)) setTab(GENERAL);
  }, [others, tab]);

  const messages = byThread.get(tab) ?? [];
  const lastId = messages.at(-1)?.id ?? 0;

  // Al ver una pestaña abierta, sus mensajes quedan leídos y se baja al final.
  useEffect(() => {
    if (!open) return;
    setSeen((s) => (s[tab] === lastId ? s : { ...s, [tab]: lastId }));
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, tab, lastId]);

  const nameOf = (id: string) => view.members.find((m) => m.id === id)?.name ?? 'Alguien';

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    const res = await call('chat:send', { to: tab === GENERAL ? null : tab, text: t });
    setSending(false);
    if (res) setText('');
  };

  return (
    <>
      <button
        className={`chat-fab${open ? ' open' : ''}`}
        onClick={() => setOpen(!open)}
        aria-label={open ? 'Cerrar chat' : `Abrir chat${totalUnread ? ` (${totalUnread} sin leer)` : ''}`}
      >
        {open ? '✕' : '💬'}
        {!open && totalUnread > 0 && <span className="chat-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
      </button>

      {open && (
        <section className="chat-panel card" aria-label="Chat de la partida">
          <div className="chat-tabs" role="tablist">
            {tabs.map((t) => {
              const n = unread(t);
              const label = t === GENERAL ? '👥 General' : `🔒 ${nameOf(t)}`;
              return (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  className={`chat-tab${tab === t ? ' active' : ''}`}
                  onClick={() => setTab(t)}
                >
                  {label}
                  {n > 0 && <span className="chat-badge small">{n}</span>}
                </button>
              );
            })}
          </div>
          <p className="chat-hint">
            {tab === GENERAL
              ? 'Lo ven todos los de la sala.'
              : `Privado: solo lo veis ${nameOf(tab)} y tú.`}{' '}
            Se borra al terminar la partida.
          </p>
          <ol className="chat-list" ref={listRef} aria-live="polite">
            {messages.length === 0 && <li className="chat-empty">Todavía no hay mensajes.</li>}
            {messages.map((m) => {
              const mine = m.from === me;
              return (
                <li key={m.id} className={`chat-msg${mine ? ' mine' : ''}`}>
                  {!mine && tab === GENERAL && <span className="chat-author">{nameOf(m.from)}</span>}
                  <span className="chat-text">{m.text}</span>
                  <time className="chat-time">
                    {new Date(m.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </li>
              );
            })}
          </ol>
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={text}
              maxLength={CHAT_MAX_LENGTH}
              onChange={(e) => setText(e.target.value)}
              placeholder={tab === GENERAL ? 'Escribe a todos…' : `Escribe a ${nameOf(tab)}…`}
              aria-label="Mensaje"
              autoComplete="off"
            />
            <button className="btn primary small" type="submit" disabled={!text.trim() || sending}>
              Enviar
            </button>
          </form>
        </section>
      )}
    </>
  );
}

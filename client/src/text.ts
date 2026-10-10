import type { LogEntry, Phase, PublicResolution } from '../../shared/game';
import { formatPlacements, type NegotiationSlot } from '../../shared/engine';
import type { ClientView } from '../../shared/view';

export const PHASE_LABEL: Record<Phase, string> = {
  FICHAS: 'Reparto de fichas',
  PUJAS_ABIERTAS: 'Subasta abierta',
  RESOLUCION: 'Resolución',
  NEGOCIACION: 'Negociación',
  COLOCACION: 'Colocación',
  RONDA_CERRADA: 'Ronda cerrada',
  FIN: 'Fin de la partida',
};

export type NameOf = (id: string) => string;

export function nameResolver(view: ClientView): NameOf {
  const names = new Map(view.members.map((m) => [m.id, m.id === view.me.id ? `${m.name} (tú)` : m.name]));
  return (id) => names.get(id) ?? 'Alguien';
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** "Ana elige 3 de la A; Luis y Eva eligen 2 cada uno de la B" */
export function describeSlots(slots: NegotiationSlot[], nameOf: NameOf): string {
  return (['A', 'B'] as const)
    .map((auction) => {
      const group = slots.filter((sl) => sl.auction === auction);
      if (!group.length) return '';
      const pick = group[0].pick;
      const n = `${pick} ${pick === 1 ? 'ficha' : 'fichas'}`;
      return group.length === 1
        ? `${nameOf(group[0].playerId)} elige ${n} de la ${auction}`
        : `${joinNames(group.map((sl) => nameOf(sl.playerId)))} eligen ${n} cada uno de la ${auction} (sin repetir)`;
    })
    .filter(Boolean)
    .join('; ');
}

/** Frase final de la resolución ("→ coloca Ana"). */
export function resolutionVerdict(r: PublicResolution, nameOf: NameOf): string {
  switch (r.outcome) {
    case 'none':
      return 'Nadie ha pujado: las fichas se descartan.';
    case 'single':
      return `Solo hubo pujas en una subasta: ${nameOf(r.recipient!.playerId)} se lleva las fichas de ${r.recipient!.auction}.`;
    case 'normal':
      return `${nameOf(r.recipient!.playerId)} pujó menos y se lleva las fichas de ${r.recipient!.auction}. Las de ${r.recipient!.auction === 'A' ? 'B' : 'A'} se eliminan.`;
    case 'shared-tie':
      return `¡Empate en la subasta ${r.slots![0].auction}! ${describeSlots(r.slots!, nameOf)}. Tenéis que poneros de acuerdo.`;
    case 'tie':
      return `¡Empate entre las dos subastas! ${describeSlots(r.slots!, nameOf)}. Tenéis que poneros de acuerdo todos.`;
    case 'same-player':
      return `${nameOf(r.recipient!.playerId)} ganó las dos: se queda con ${r.recipient!.auction}, donde pujó menos, y pierde ambas pujas.`;
    case 'same-player-choice':
      return r.recipient
        ? `${nameOf(r.recipient.playerId)} ganó las dos con la misma puja y eligió ${r.recipient.auction}.`
        : `${nameOf(r.winners.A!.playerIds[0])} ganó las dos con la misma puja: elige subasta.`;
  }
}

export function winnerLine(r: PublicResolution, id: 'A' | 'B', nameOf: NameOf): string {
  const w = r.winners[id];
  if (!w) return `Subasta ${id}: sin pujas`;
  if (w.playerIds.length > 1) return `Subasta ${id}: empate entre ${joinNames(w.playerIds.map(nameOf))} (${w.bid})`;
  return `Subasta ${id}: ${nameOf(w.playerIds[0])} (${w.bid})`;
}

export function logText(e: LogEntry, nameOf: NameOf): string {
  switch (e.type) {
    case 'resolution':
      return `${winnerLine(e.resolution, 'A', nameOf)} · ${winnerLine(e.resolution, 'B', nameOf)}`;
    case 'placement':
      return `${joinNames(e.playerIds.map(nameOf))}${e.random ? ' (al azar)' : ''}: ${formatPlacements(e.placements)}`;
    case 'null-round':
      return `Ronda nula: ${joinNames(e.playerIds.map(nameOf))} ${e.reason === 'tiempo' ? 'agotaron el tiempo' : 'no llegaron a un acuerdo'}. Pierden su puja.`;
    case 'peek':
      return `👀 ${nameOf(e.by)} ha mirado las pujas.`;
    case 'peek-history':
      return `📜 ${nameOf(e.by)} ha mirado las pujas de rondas anteriores.`;
    case 'peek-chats':
      return `👁 ${nameOf(e.by)} ha mirado todos los chats.`;
    case 'coins': {
      const diff = e.to - e.from;
      return `🪙 El anfitrión ${diff > 0 ? `ha dado ${diff}` : `ha quitado ${-diff}`} ${Math.abs(diff) === 1 ? 'moneda' : 'monedas'} a ${nameOf(e.playerId)} (${e.from} → ${e.to}).`;
    }
    case 'ended':
      return '🏁 El anfitrión ha terminado la partida antes de tiempo.';
  }
}

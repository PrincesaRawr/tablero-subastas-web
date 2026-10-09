import type { LogEntry, Phase, PublicResolution } from '../../shared/game';
import { formatPlacements } from '../../shared/engine';
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

/** Frase final de la resolución ("→ coloca Ana"). */
export function resolutionVerdict(r: PublicResolution, nameOf: NameOf): string {
  switch (r.outcome) {
    case 'none':
      return 'Nadie ha pujado: las fichas se descartan.';
    case 'single':
      return `Solo hubo pujas en una subasta: ${nameOf(r.recipient!.playerId)} se lleva las fichas de ${r.recipient!.auction}.`;
    case 'normal':
      return `${nameOf(r.recipient!.playerId)} pujó menos y se lleva las fichas de ${r.recipient!.auction}. Las de ${r.recipient!.auction === 'A' ? 'B' : 'A'} se eliminan.`;
    case 'shared-tie': {
      const w = r.winners[r.sharedAuction!]!;
      return `¡Empate en la subasta ${r.sharedAuction}! ${nameOf(w.playerId)} y ${nameOf(w.coWinner!)} tienen que ponerse de acuerdo para colocar sus 5 fichas.`;
    }
    case 'tie':
      return `¡Empate! ${nameOf(r.winners.A!.playerId)} y ${nameOf(r.winners.B!.playerId)} tienen que negociar.`;
    case 'same-player':
      return `${nameOf(r.recipient!.playerId)} ganó las dos: se queda con ${r.recipient!.auction}, donde pujó menos, y pierde ambas pujas.`;
    case 'same-player-choice':
      return r.recipient
        ? `${nameOf(r.recipient.playerId)} ganó las dos con la misma puja y eligió ${r.recipient.auction}.`
        : `${nameOf(r.winners.A!.playerId)} ganó las dos con la misma puja: elige subasta.`;
  }
}

export function winnerLine(r: PublicResolution, id: 'A' | 'B', nameOf: NameOf): string {
  const w = r.winners[id];
  if (!w) return `Subasta ${id}: sin pujas`;
  if (w.coWinner) return `Subasta ${id}: empate entre ${nameOf(w.playerId)} y ${nameOf(w.coWinner)} (${w.bid})`;
  const tie = w.tiedWith.length ? ` · desempate al azar con ${joinNames(w.tiedWith.map(nameOf))}` : '';
  return `Subasta ${id}: ${nameOf(w.playerId)} (${w.bid})${tie}`;
}

export function logText(e: LogEntry, nameOf: NameOf): string {
  switch (e.type) {
    case 'resolution':
      return `${winnerLine(e.resolution, 'A', nameOf)} · ${winnerLine(e.resolution, 'B', nameOf)}`;
    case 'placement':
      return `${joinNames(e.playerIds.map(nameOf))}${e.random ? ' (al azar)' : ''}: ${formatPlacements(e.placements)}`;
    case 'null-round':
      return `Ronda nula: ${joinNames(e.playerIds.map(nameOf))} ${e.reason === 'tiempo' ? 'agotaron el tiempo' : 'no llegaron a un acuerdo'}. Ambos pierden su puja.`;
    case 'peek':
      return `👀 ${nameOf(e.by)} ha mirado las pujas.`;
    case 'coins': {
      const diff = e.to - e.from;
      return `🪙 El anfitrión ${diff > 0 ? `ha dado ${diff}` : `ha quitado ${-diff}`} ${Math.abs(diff) === 1 ? 'moneda' : 'monedas'} a ${nameOf(e.playerId)} (${e.from} → ${e.to}).`;
    }
    case 'ended':
      return '🏁 El anfitrión ha terminado la partida antes de tiempo.';
  }
}

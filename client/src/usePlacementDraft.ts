import { useEffect, useMemo, useState } from 'react';
import type { Color } from '../../shared/config';
import type { Cell, Placement } from '../../shared/engine';

interface Staged extends Cell {
  tokenIdx: number;
}

/**
 * Borrador local de una colocación: elegir ficha → clic en casilla libre.
 * Se reinicia cuando cambia `resetKey` (nueva ronda, nuevas fichas…).
 */
export function usePlacementDraft(tokens: Color[], resetKey: string) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    setStaged([]);
    setSelected(null);
  }, [resetKey]);

  const usedIdx = new Set(staged.map((s) => s.tokenIdx));
  const remaining = tokens.map((_, i) => i).filter((i) => !usedIdx.has(i));

  const placements: Placement[] = useMemo(
    () => staged.map((s) => ({ color: tokens[s.tokenIdx], row: s.row, col: s.col })),
    [staged, tokens],
  );

  /** Clic en una casilla: si tiene ficha provisional la quita; si está libre coloca la seleccionada. */
  const clickCell = (cell: Cell) => {
    const existing = staged.find((s) => s.row === cell.row && s.col === cell.col);
    if (existing) {
      setStaged(staged.filter((s) => s !== existing));
      setSelected(existing.tokenIdx);
      return;
    }
    const idx = selected !== null && !usedIdx.has(selected) ? selected : remaining[0];
    if (idx === undefined) return;
    const next = [...staged, { ...cell, tokenIdx: idx }];
    setStaged(next);
    const nextUsed = new Set(next.map((s) => s.tokenIdx));
    // tras colocar, selecciona automáticamente la siguiente ficha libre
    setSelected(tokens.map((_, i) => i).find((i) => !nextUsed.has(i)) ?? null);
  };

  return {
    placements,
    selected,
    select: (i: number) => !usedIdx.has(i) && setSelected(i),
    isUsed: (i: number) => usedIdx.has(i),
    clickCell,
    undo: () => {
      const last = staged[staged.length - 1];
      if (!last) return;
      setStaged(staged.slice(0, -1));
      setSelected(last.tokenIdx);
    },
    clear: () => {
      setStaged([]);
      setSelected(0);
    },
    complete: tokens.length > 0 && staged.length === tokens.length,
  };
}

export type PlacementDraft = ReturnType<typeof usePlacementDraft>;

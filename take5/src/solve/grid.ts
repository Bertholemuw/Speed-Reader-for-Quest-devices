import type { Cell, Grid, Slot } from '../types.ts';

export const BLOCK = '#';

export function isBlock(value: string | undefined): boolean {
  return value === undefined || value === BLOCK;
}

/**
 * Every across/down run of two or more open squares. These are the positions
 * that have to hold a real word, and they are what every grid solver searches
 * over.
 */
export function extractSlots(grid: Grid): Slot[] {
  const slots: Slot[] = [];
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  const push = (cells: Cell[], direction: 'across' | 'down') => {
    if (cells.length < 2) return;
    const head = cells[0];
    slots.push({ id: `${direction[0]}-${head.r}-${head.c}-${cells.length}`, cells, direction });
  };

  for (let r = 0; r < rows; r++) {
    let run: Cell[] = [];
    for (let c = 0; c < cols; c++) {
      if (isBlock(grid[r][c])) {
        push(run, 'across');
        run = [];
      } else {
        run.push({ r, c });
      }
    }
    push(run, 'across');
  }

  for (let c = 0; c < cols; c++) {
    let run: Cell[] = [];
    for (let r = 0; r < rows; r++) {
      if (isBlock(grid[r]?.[c])) {
        push(run, 'down');
        run = [];
      } else {
        run.push({ r, c });
      }
    }
    push(run, 'down');
  }

  return slots;
}

/**
 * Standard crossword numbering: a square gets the next number when it begins an
 * across run, a down run, or both. Used to tie printed clues to grid slots.
 */
export function numberSlots(grid: Grid, slots: Slot[]): Slot[] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const numberAt = new Map<string, number>();
  let next = 1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isBlock(grid[r][c])) continue;
      const startsAcross = isBlock(grid[r][c - 1]) && !isBlock(grid[r][c + 1]);
      const startsDown = isBlock(grid[r - 1]?.[c]) && !isBlock(grid[r + 1]?.[c]);
      if (startsAcross || startsDown) numberAt.set(`${r},${c}`, next++);
    }
  }

  return slots.map((slot) => {
    const head = slot.cells[0];
    const number = numberAt.get(`${head.r},${head.c}`);
    return number === undefined ? slot : { ...slot, number };
  });
}

/** Current letters in a slot, with `?` for squares still empty. */
export function patternOf(grid: Grid, slot: Slot): string {
  return slot.cells.map(({ r, c }) => grid[r][c] || '?').join('');
}

export function readCells(grid: Grid, cells: Cell[]): string {
  return cells.map(({ r, c }) => grid[r]?.[c] ?? '').join('');
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

/** Slots that share at least one square with `slot`. */
export function crossingSlots(slots: Slot[], slot: Slot): Slot[] {
  const own = new Set(slot.cells.map((c) => `${c.r},${c.c}`));
  return slots.filter((other) => other.id !== slot.id && other.cells.some((c) => own.has(`${c.r},${c.c}`)));
}

import type { Grid, Slot } from '../types.ts';
import { cloneGrid, extractSlots, patternOf } from './grid.ts';

/**
 * Kriss Kross: an empty grid plus a bank of words, each used exactly once.
 * Backtracking over slots, always taking the slot with the fewest surviving
 * candidates, which collapses the search almost immediately once a couple of
 * long words are placed.
 */

export interface KrisskrossResult {
  solved: boolean;
  grid: Grid | null;
  /** slot id -> word */
  placements: Record<string, string>;
  reason?: string;
}

export function solveKrisskross(grid: Grid, words: string[]): KrisskrossResult {
  const slots = extractSlots(grid);
  const bank = words.map((w) => w.toUpperCase().replace(/[^A-Z]/g, '')).filter(Boolean);

  if (slots.length !== bank.length) {
    return {
      solved: false,
      grid: null,
      placements: {},
      reason: `grid has ${slots.length} slots but ${bank.length} words were listed`,
    };
  }

  const working = cloneGrid(grid);
  const used = new Array<boolean>(bank.length).fill(false);
  const placements: Record<string, string> = {};
  const done = new Set<string>();

  const fits = (slot: Slot, word: string): boolean => {
    if (word.length !== slot.cells.length) return false;
    const pattern = patternOf(working, slot);
    for (let i = 0; i < word.length; i++) {
      const current = pattern[i];
      if (current !== '?' && current !== word[i]) return false;
    }
    return true;
  };

  const write = (slot: Slot, word: string): (string | null)[] => {
    const undo: (string | null)[] = [];
    slot.cells.forEach(({ r, c }, i) => {
      undo.push(working[r][c] === '' ? null : working[r][c]);
      working[r][c] = word[i];
    });
    return undo;
  };

  const restore = (slot: Slot, undo: (string | null)[]): void => {
    slot.cells.forEach(({ r, c }, i) => {
      working[r][c] = undo[i] ?? '';
    });
  };

  const search = (): boolean => {
    let target: Slot | null = null;
    let best: number[] = [];

    for (const slot of slots) {
      if (done.has(slot.id)) continue;
      const options: number[] = [];
      for (let i = 0; i < bank.length; i++) {
        if (!used[i] && fits(slot, bank[i])) options.push(i);
      }
      if (options.length === 0) return false;
      if (target === null || options.length < best.length) {
        target = slot;
        best = options;
        if (options.length === 1) break;
      }
    }

    if (target === null) return true;

    // Distinct words only: two identical strings in the bank are interchangeable,
    // so trying both just doubles the work.
    const tried = new Set<string>();
    for (const index of best) {
      const word = bank[index];
      if (tried.has(word)) continue;
      tried.add(word);

      const undo = write(target, word);
      used[index] = true;
      done.add(target.id);
      placements[target.id] = word;

      if (search()) return true;

      delete placements[target.id];
      done.delete(target.id);
      used[index] = false;
      restore(target, undo);
    }

    return false;
  };

  if (!search()) {
    return { solved: false, grid: null, placements: {}, reason: 'words do not fit the grid' };
  }
  return { solved: true, grid: working, placements };
}

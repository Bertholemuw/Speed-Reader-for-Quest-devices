import type { Grid, Slot } from '../types.ts';
import type { Dictionary } from './dictionary.ts';
import { extractSlots } from './grid.ts';

/**
 * Code Cracker / Codeword: every square holds a number 1-26 standing for a
 * letter, the same number always meaning the same letter. A few are given away.
 *
 * Solved as a constraint search over slots rather than over squares — filling a
 * whole word at a time prunes far harder than guessing one letter at a time,
 * and each word placed pins several codes at once.
 */

export interface CodewordResult {
  solved: boolean;
  /** code (1-26) -> letter */
  mapping: Record<number, string>;
  grid: Grid | null;
  reason?: string;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Codes laid out as a grid, with 0 meaning a blocked square. */
function gridFromCodes(codes: number[][]): Grid {
  return codes.map((row) => row.map((code) => (code === 0 ? '#' : '')));
}

export function solveCodeword(
  codes: number[][],
  given: Record<string, string>,
  dict: Dictionary,
): CodewordResult {
  const shape = gridFromCodes(codes);
  const slots = extractSlots(shape);
  if (slots.length === 0) {
    return { solved: false, mapping: {}, grid: null, reason: 'no word slots found in grid' };
  }

  const codeToLetter = new Map<number, string>();
  const letterToCode = new Map<string, number>();

  for (const [code, letter] of Object.entries(given)) {
    const n = Number(code);
    const ch = letter.toUpperCase();
    if (!Number.isInteger(n) || n < 1 || n > 26 || !LETTERS.includes(ch)) {
      return { solved: false, mapping: {}, grid: null, reason: `bad given: ${code}=${letter}` };
    }
    if (letterToCode.has(ch) && letterToCode.get(ch) !== n) {
      return { solved: false, mapping: {}, grid: null, reason: `letter ${ch} given for two codes` };
    }
    codeToLetter.set(n, ch);
    letterToCode.set(ch, n);
  }

  const slotCodes = new Map<string, number[]>();
  for (const slot of slots) {
    slotCodes.set(slot.id, slot.cells.map(({ r, c }) => codes[r][c]));
  }

  /** Words that could still go in this slot given what is already assigned. */
  const candidatesFor = (slot: Slot): string[] => {
    const seq = slotCodes.get(slot.id)!;
    const pattern = seq.map((code) => codeToLetter.get(code) ?? '?').join('');
    const pool = dict.match(pattern);

    return pool.filter((word) => {
      const localCode = new Map<number, string>();
      const localLetter = new Map<string, number>();
      for (let i = 0; i < seq.length; i++) {
        const code = seq[i];
        const ch = word[i];

        // A letter already spoken for by a different code is unavailable.
        const boundCode = letterToCode.get(ch);
        if (boundCode !== undefined && boundCode !== code) return false;

        // Within the word, one code must mean one letter and vice versa.
        const seenLetter = localCode.get(code);
        if (seenLetter !== undefined && seenLetter !== ch) return false;
        const seenCode = localLetter.get(ch);
        if (seenCode !== undefined && seenCode !== code) return false;

        localCode.set(code, ch);
        localLetter.set(ch, code);
      }
      return true;
    });
  };

  const filled = new Set<string>();

  const search = (): boolean => {
    let target: Slot | null = null;
    let best: string[] = [];

    for (const slot of slots) {
      if (filled.has(slot.id)) continue;
      const options = candidatesFor(slot);
      if (options.length === 0) return false;
      if (target === null || options.length < best.length) {
        target = slot;
        best = options;
        if (options.length === 1) break;
      }
    }

    if (target === null) return true; // every slot holds a word

    const seq = slotCodes.get(target.id)!;
    for (const word of best) {
      const applied: number[] = [];
      let ok = true;

      for (let i = 0; i < seq.length && ok; i++) {
        const code = seq[i];
        const ch = word[i];
        const bound = codeToLetter.get(code);
        if (bound === undefined) {
          if (letterToCode.has(ch)) ok = false;
          else {
            codeToLetter.set(code, ch);
            letterToCode.set(ch, code);
            applied.push(code);
          }
        } else if (bound !== ch) {
          ok = false;
        }
      }

      if (ok) {
        filled.add(target.id);
        if (search()) return true;
        filled.delete(target.id);
      }

      for (const code of applied) {
        const ch = codeToLetter.get(code)!;
        codeToLetter.delete(code);
        letterToCode.delete(ch);
      }
    }

    return false;
  };

  if (!search()) {
    return { solved: false, mapping: {}, grid: null, reason: 'no consistent letter assignment' };
  }

  const grid: Grid = codes.map((row) =>
    row.map((code) => (code === 0 ? '#' : codeToLetter.get(code) ?? '')),
  );

  const mapping: Record<number, string> = {};
  for (const [code, letter] of codeToLetter) mapping[code] = letter;

  return { solved: true, mapping, grid };
}

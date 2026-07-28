import type { Clue, Grid, Slot } from '../types.ts';
import type { Dictionary } from './dictionary.ts';
import { cloneGrid, extractSlots, numberSlots, patternOf } from './grid.ts';

/**
 * Crosswords are the one puzzle type that can't be solved from the grid alone —
 * the clues carry knowledge no dictionary has. So the grid search stays here and
 * deterministic, and the guessing is pushed behind `ClueOracle`, which the
 * Gemini adapter implements and tests stub out.
 *
 * A word suggested by the oracle is preferred, but the grid is the referee: a
 * suggestion only survives if it fits every crossing. Where the oracle is no
 * help we fall back to dictionary words, and the returned confidence says how
 * much of the fill rested on real answers versus anything-that-fits.
 */

export interface ClueRequest {
  number: number;
  direction: 'across' | 'down';
  text: string;
  length: number;
}

export interface ClueOracle {
  readonly name: string;
  /** Ranked candidate answers keyed by `${direction}-${number}`. */
  suggest(requests: ClueRequest[]): Promise<Record<string, string[]>>;
}

export const NullOracle: ClueOracle = {
  name: 'none',
  async suggest() {
    return {};
  },
};

export interface CrosswordResult {
  solved: boolean;
  grid: Grid | null;
  confidence: number;
  /** slot id -> chosen word */
  placements: Record<string, string>;
  /** Clues the oracle could not help with, filled from the dictionary instead. */
  guessed: string[];
  reason?: string;
}

const clueKey = (direction: string, number: number) => `${direction}-${number}`;

/** How much we trust a fill: top suggestion > also-ran > dictionary guess. */
function scoreOf(rank: number): number {
  if (rank === 0) return 1;
  if (rank > 0 && rank < 3) return 0.85;
  if (rank >= 3) return 0.6;
  return 0.25; // dictionary fallback, no oracle support at all
}

export async function solveCrossword(
  grid: Grid,
  clues: Clue[],
  dict: Dictionary,
  oracle: ClueOracle = NullOracle,
): Promise<CrosswordResult> {
  const slots = numberSlots(grid, extractSlots(grid));
  if (slots.length === 0) {
    return { solved: false, grid: null, confidence: 0, placements: {}, guessed: [], reason: 'no slots' };
  }

  const slotForClue = new Map<string, Slot>();
  for (const slot of slots) {
    if (slot.number !== undefined) slotForClue.set(clueKey(slot.direction, slot.number), slot);
  }

  const requests: ClueRequest[] = [];
  const clueForSlot = new Map<string, Clue>();
  for (const clue of clues) {
    const slot = slotForClue.get(clueKey(clue.direction, clue.number));
    if (!slot) continue;
    clueForSlot.set(slot.id, clue);
    requests.push({
      number: clue.number,
      direction: clue.direction,
      text: clue.text,
      length: slot.cells.length,
    });
  }

  let suggestions: Record<string, string[]> = {};
  if (requests.length > 0) {
    try {
      suggestions = await oracle.suggest(requests);
    } catch {
      suggestions = {}; // an oracle outage degrades to a dictionary fill, not a crash
    }
  }

  /** Oracle candidates for a slot, cleaned and length-checked. */
  const rankedFor = (slot: Slot): string[] => {
    const clue = clueForSlot.get(slot.id);
    if (!clue) return [];
    const raw = suggestions[clueKey(clue.direction, clue.number)] ?? [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of raw) {
      const word = item.toUpperCase().replace(/[^A-Z]/g, '');
      if (word.length === slot.cells.length && !seen.has(word)) {
        seen.add(word);
        out.push(word);
      }
    }
    return out;
  };

  const ranked = new Map<string, string[]>();
  for (const slot of slots) ranked.set(slot.id, rankedFor(slot));

  const working = cloneGrid(grid);
  const placements: Record<string, string> = {};
  const rankUsed = new Map<string, number>();
  const done = new Set<string>();

  const candidatesFor = (slot: Slot): string[] => {
    const pattern = patternOf(working, slot);
    const fromOracle = ranked.get(slot.id)!.filter((word) =>
      [...pattern].every((ch, i) => ch === '?' || ch === word[i]),
    );
    const seen = new Set(fromOracle);
    const fromDict = dict.match(pattern).filter((word) => !seen.has(word));
    return [...fromOracle, ...fromDict];
  };

  const write = (slot: Slot, word: string): (string | null)[] =>
    slot.cells.map(({ r, c }, i) => {
      const previous = working[r][c] === '' ? null : working[r][c];
      working[r][c] = word[i];
      return previous;
    });

  const restore = (slot: Slot, undo: (string | null)[]): void => {
    slot.cells.forEach(({ r, c }, i) => {
      working[r][c] = undo[i] ?? '';
    });
  };

  // Bounded so a badly-parsed grid fails in seconds instead of spinning.
  let steps = 0;
  const STEP_LIMIT = 400_000;

  const search = (): boolean => {
    if (++steps > STEP_LIMIT) return false;

    let target: Slot | null = null;
    let best: string[] = [];

    for (const slot of slots) {
      if (done.has(slot.id)) continue;
      const options = candidatesFor(slot);
      if (options.length === 0) return false;
      if (target === null || options.length < best.length) {
        target = slot;
        best = options;
        if (options.length === 1) break;
      }
    }

    if (target === null) return true;

    const oracleWords = ranked.get(target.id)!;
    for (const word of best) {
      const undo = write(target, word);
      done.add(target.id);
      placements[target.id] = word;
      rankUsed.set(target.id, oracleWords.indexOf(word));

      if (search()) return true;

      rankUsed.delete(target.id);
      delete placements[target.id];
      done.delete(target.id);
      restore(target, undo);
    }
    return false;
  };

  if (!search()) {
    return {
      solved: false,
      grid: null,
      confidence: 0,
      placements: {},
      guessed: [],
      reason: steps > STEP_LIMIT ? 'search limit hit — check the parsed grid' : 'no consistent fill',
    };
  }

  const clued = slots.filter((s) => clueForSlot.has(s.id));
  const scored = clued.length > 0 ? clued : slots;
  const confidence =
    scored.reduce((sum, slot) => sum + scoreOf(rankUsed.get(slot.id) ?? -1), 0) / scored.length;

  const guessed = clued
    .filter((slot) => (rankUsed.get(slot.id) ?? -1) < 0)
    .map((slot) => {
      const clue = clueForSlot.get(slot.id)!;
      return `${clue.number} ${clue.direction}: ${clue.text}`;
    });

  return { solved: true, grid: working, confidence, placements, guessed };
}

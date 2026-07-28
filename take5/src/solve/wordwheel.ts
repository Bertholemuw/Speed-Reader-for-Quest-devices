import type { Dictionary } from './dictionary.ts';

/**
 * Word wheel / target puzzle: a centre letter ringed by others. Every answer
 * must use the centre letter and may use each outer letter at most once. The
 * prize answer is the word using all of them.
 */

export interface WordwheelResult {
  solved: boolean;
  /** Every valid word, longest first. */
  words: string[];
  /** The word using every letter on the wheel, if there is exactly one. */
  fullWord: string | null;
  ambiguous: boolean;
}

function letterCounts(word: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of word) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return counts;
}

export function solveWordwheel(
  centre: string,
  outer: string[],
  dict: Dictionary,
  minLength = 4,
): WordwheelResult {
  const centreLetter = centre.toUpperCase().replace(/[^A-Z]/g, '');
  const ring = outer.map((l) => l.toUpperCase().replace(/[^A-Z]/g, '')).filter(Boolean);

  if (centreLetter.length !== 1 || ring.length === 0) {
    return { solved: false, words: [], fullWord: null, ambiguous: false };
  }

  const available = letterCounts(centreLetter + ring.join(''));
  const total = 1 + ring.length;

  const usable = (word: string): boolean => {
    if (!word.includes(centreLetter)) return false;
    const need = letterCounts(word);
    for (const [ch, count] of need) {
      if ((available.get(ch) ?? 0) < count) return false;
    }
    return true;
  };

  const words: string[] = [];
  for (let length = minLength; length <= total; length++) {
    for (const word of dict.wordsOfLength(length)) {
      if (usable(word)) words.push(word);
    }
  }

  words.sort((a, b) => b.length - a.length || a.localeCompare(b));
  const full = words.filter((w) => w.length === total);

  return {
    solved: words.length > 0,
    words,
    fullWord: full.length === 1 ? full[0] : full[0] ?? null,
    ambiguous: full.length > 1,
  };
}

// Splits book text into the units the RSVP reader flashes one at a time.

/** Bump when the splitting rules change, so saved positions can be migrated. */
export const TOKENIZER_VERSION = 2;

// Split after a hyphen/dash run that follows a word character and precedes more text:
// "well-to-do" -> "well-", "to-", "do"; "him—and" -> "him—", "and"; "word--word" -> "word--", "word".
// A leading dash ("—Yes") stays attached.
const DASH_BREAK = /(?<=[^\s\-‐‑–—][\-‐‑–—]+)(?=[^\-‐‑–—])/u;

export const tokenize = (text: string): string[] =>
  text.split(/\s+/).filter(Boolean).flatMap(w => w.split(DASH_BREAK));

/** Converts a position saved with the old whitespace-only splitting. */
export const migratePosition = (text: string, oldPos: number): number => {
  if (oldPos <= 0) return 0;
  const before = text.split(/\s+/).filter(Boolean).slice(0, oldPos).join(' ');
  return tokenize(before).length;
};


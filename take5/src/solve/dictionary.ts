import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Word list shared by every grid solver. Words are upper-cased and stripped of
 * anything that can't appear in a puzzle square, then bucketed by length so a
 * pattern lookup only scans candidates that could possibly fit.
 */
export class Dictionary {
  private readonly byLength = new Map<number, string[]>();
  private readonly all = new Set<string>();
  private readonly patternCache = new Map<string, string[]>();
  /** Prefixes of every word, so partial fills can be abandoned early. */
  private readonly prefixes = new Set<string>();
  private prefixLimit = 0;

  constructor(words: Iterable<string>, extra: Iterable<string> = []) {
    for (const source of [words, extra]) {
      for (const raw of source) {
        const word = raw.toUpperCase().replace(/[^A-Z]/g, '');
        if (word.length < 2 || this.all.has(word)) continue;
        this.all.add(word);
        const bucket = this.byLength.get(word.length);
        if (bucket) bucket.push(word);
        else this.byLength.set(word.length, [word]);
      }
    }
  }

  static fromBundled(extra: Iterable<string> = []): Dictionary {
    // The package ships a plain JSON array; `require` avoids ESM import attributes.
    const words = require('an-array-of-english-words') as string[];
    return new Dictionary(words, extra);
  }

  has(word: string): boolean {
    return this.all.has(word.toUpperCase());
  }

  get size(): number {
    return this.all.size;
  }

  wordsOfLength(length: number): readonly string[] {
    return this.byLength.get(length) ?? [];
  }

  /**
   * Every word matching a pattern, where `?` (or `.`) is an unknown square and
   * any other character is a fixed letter. `C?T` yields CAT, COT, CUT...
   */
  match(pattern: string): readonly string[] {
    const key = pattern.toUpperCase().replace(/\./g, '?');
    const cached = this.patternCache.get(key);
    if (cached) return cached;

    const bucket = this.byLength.get(key.length) ?? [];
    let result: string[];
    if (!key.includes('?')) {
      result = this.all.has(key) ? [key] : [];
    } else {
      // Scan on the rarest fixed letter first: cheaper than a regex per word.
      const fixed: [number, string][] = [];
      for (let i = 0; i < key.length; i++) {
        const ch = key[i];
        if (ch !== '?') fixed.push([i, ch]);
      }
      result = fixed.length === 0
        ? bucket.slice()
        : bucket.filter((word) => fixed.every(([i, ch]) => word[i] === ch));
    }
    this.patternCache.set(key, result);
    return result;
  }

  /**
   * True when some word starts with `prefix`. Built lazily up to the longest
   * prefix asked for, because indexing every prefix of 275k words is wasteful
   * when a puzzle only ever probes the first few letters.
   */
  hasPrefix(prefix: string): boolean {
    const key = prefix.toUpperCase();
    if (key.length === 0) return true;
    if (key.length > this.prefixLimit) this.indexPrefixes(key.length);
    return this.prefixes.has(key);
  }

  private indexPrefixes(upTo: number): void {
    for (const word of this.all) {
      const max = Math.min(upTo, word.length);
      for (let n = this.prefixLimit + 1; n <= max; n++) {
        this.prefixes.add(word.slice(0, n));
      }
    }
    this.prefixLimit = upTo;
  }
}

let shared: Dictionary | null = null;

/** Process-wide dictionary; building it costs ~250ms so it is done once. */
export function sharedDictionary(extra: Iterable<string> = []): Dictionary {
  if (!shared) shared = Dictionary.fromBundled(extra);
  return shared;
}

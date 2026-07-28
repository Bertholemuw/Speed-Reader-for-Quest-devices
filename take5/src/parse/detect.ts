import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  Clue,
  Grid,
  Puzzle,
  PuzzleKind,
  PuzzlePayload,
} from '../types.ts';
import { logger } from '../logger.ts';
import { extractSlots, numberSlots } from '../solve/grid.ts';
import type { PdfPage } from './pdf.ts';
import {
  detectLattices,
  groupLines,
  linesOutside,
  shadedCells,
  type Lattice,
  type Line,
} from './layout.ts';

const log = logger('detect');

/**
 * Recipe-driven puzzle recognition.
 *
 * Magazine layouts drift between issues, so nothing here is hard-coded to a
 * particular page. A rule says "a heading matching this pattern introduces a
 * puzzle of this kind, entered through this form", and the geometry from
 * `layout.ts` supplies the rest. When the layout changes you edit the recipe,
 * not this file.
 */

export const RuleSchema = z.object({
  kind: z.enum([
    'sudoku',
    'wordsearch',
    'codeword',
    'krisskross',
    'wordwheel',
    'crossword',
    'trivia',
  ]),
  /** Case-insensitive regex tested against each line of the page. */
  match: z.string().min(1),
  formId: z.string().default(''),
  /** Where the posted answer comes from; shaded cells by default. */
  answerFrom: z.enum(['keyword', 'grid', 'phrase']).default('keyword'),
  cryptic: z.boolean().default(false),
  /** Smallest lattice that counts as this puzzle's grid. */
  minGrid: z.number().int().positive().default(4),
});
export type Rule = z.infer<typeof RuleSchema>;

export const RecipeSchema = z.object({
  rules: z.array(RuleSchema).default([]),
  /** Matches the closing date printed near a puzzle. */
  closesPattern: z
    .string()
    .default('(?:closes?|entries close)[^0-9]{0,20}(\\d{1,2}\\s+\\w+\\s+\\d{4})'),
  prizePattern: z.string().default('(\\$[\\d,]+(?:\\.\\d{2})?)'),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const DEFAULT_RECIPE: Recipe = RecipeSchema.parse({
  rules: [
    { kind: 'crossword', match: '\\b(quick\\s+)?crossword\\b' },
    { kind: 'crossword', match: '\\bcryptic\\b', cryptic: true },
    { kind: 'codeword', match: '\\b(code\\s*cracker|codeword|code\\s*word)\\b' },
    { kind: 'wordsearch', match: '\\b(word\\s*search|wordsearch)\\b' },
    { kind: 'krisskross', match: '\\b(kriss?\\s*kross|criss\\s*cross)\\b' },
    { kind: 'wordwheel', match: '\\b(word\\s*wheel|target|nine\\s*letter)\\b' },
    { kind: 'sudoku', match: '\\bsudoku\\b' },
    { kind: 'trivia', match: '\\b(trivia|quiz|general\\s+knowledge)\\b' },
  ],
});

function idFor(issueId: string, page: number, kind: string, seed: string): string {
  const hash = createHash('sha1').update(`${issueId}:${page}:${kind}:${seed}`).digest('hex');
  return `${kind}-p${page}-${hash.slice(0, 6)}`;
}

/** Lattice -> solver grid: `#` for blocks, printed letters otherwise. */
function gridFromLattice(lattice: Lattice, keepText = true): Grid {
  return lattice.cells.map((row) =>
    row.map((cell) => {
      if (cell.kind === 'block') return '#';
      if (!keepText) return '';
      const letters = cell.text.toUpperCase().replace(/[^A-Z]/g, '');
      return letters.length === 1 ? letters : '';
    }),
  );
}

function digitsFromLattice(lattice: Lattice): number[][] {
  return lattice.cells.map((row) =>
    row.map((cell) => {
      const digits = cell.text.replace(/[^0-9]/g, '');
      return digits ? Number(digits) : 0;
    }),
  );
}

/** The lattice nearest below a heading — magazine puzzles sit under their title. */
function latticeFor(heading: Line, lattices: Lattice[], minGrid: number): Lattice | null {
  const usable = lattices.filter((l) => l.rows >= minGrid && l.cols >= minGrid);
  if (usable.length === 0) return null;

  const below = usable.filter((l) => l.region.y1 <= heading.y + heading.height);
  const pool = below.length > 0 ? below : usable;
  return pool.reduce((best, l) =>
    Math.abs(heading.y - l.region.y1) < Math.abs(heading.y - best.region.y1) ? l : best,
  );
}

/** ACROSS/DOWN blocks split into numbered clues. */
function parseClues(lines: Line[], grid: Grid): Clue[] {
  const slots = numberSlots(grid, extractSlots(grid));
  const lengthOf = new Map<string, number>();
  for (const slot of slots) {
    if (slot.number !== undefined) lengthOf.set(`${slot.direction}-${slot.number}`, slot.cells.length);
  }

  const clues: Clue[] = [];
  let direction: 'across' | 'down' | null = null;

  for (const line of lines) {
    const heading = line.text.trim().toUpperCase();
    if (/^ACROSS\b/.test(heading)) {
      direction = 'across';
      continue;
    }
    if (/^DOWN\b/.test(heading)) {
      direction = 'down';
      continue;
    }
    if (!direction) continue;

    // A line can carry several clues: "1 Feline pet 4 Exist 5 Number".
    const parts = line.text.matchAll(/(\d{1,2})\s*[.):]?\s+([^0-9]{2,}?)(?=\s+\d{1,2}[\s.):]|$)/g);
    for (const part of parts) {
      const number = Number(part[1]);
      const text = part[2].trim().replace(/\s+/g, ' ');
      if (!text) continue;
      const enumerated = /\((\d+)\)\s*$/.exec(text);
      clues.push({
        number,
        direction,
        text: text.replace(/\s*\(\d+\)\s*$/, ''),
        length: lengthOf.get(`${direction}-${number}`) ?? (enumerated ? Number(enumerated[1]) : 0),
      });
    }
  }

  return clues;
}

/** Word banks are printed as columns of bare uppercase words. */
function parseWordList(lines: Line[]): string[] {
  const words: string[] = [];
  for (const line of lines) {
    const tokens = line.text.split(/[\s,·•|]+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const clean = tokens
      .map((t) => t.toUpperCase().replace(/[^A-Z]/g, ''))
      .filter((t) => t.length >= 3);
    // Only take lines that are essentially all word-bank entries, so body copy
    // and advertising never leak into the list.
    if (clean.length > 0 && clean.length / tokens.length >= 0.8) words.push(...clean);
  }
  return [...new Set(words)];
}

function buildPayload(
  kind: PuzzleKind,
  lattice: Lattice | null,
  context: Line[],
  cryptic: boolean,
): { payload: PuzzlePayload; warnings: string[] } | null {
  const warnings: string[] = [];

  switch (kind) {
    case 'sudoku': {
      if (!lattice) return null;
      if (lattice.rows !== 9 || lattice.cols !== 9) {
        warnings.push(`sudoku grid read as ${lattice.rows}x${lattice.cols}, expected 9x9`);
      }
      return { payload: { givens: digitsFromLattice(lattice) }, warnings };
    }

    case 'codeword': {
      if (!lattice) return null;
      const codes = digitsFromLattice(lattice);
      const given: Record<string, string> = {};
      lattice.cells.flat().forEach((cell) => {
        const letter = cell.text.toUpperCase().replace(/[^A-Z]/g, '');
        const code = cell.text.replace(/[^0-9]/g, '');
        if (letter.length === 1 && code) given[code] = letter;
      });
      if (Object.keys(given).length === 0) {
        warnings.push('no starter letters found — the solve may be slow or ambiguous');
      }
      return { payload: { codes, given }, warnings };
    }

    case 'wordsearch': {
      if (!lattice) return null;
      const grid = gridFromLattice(lattice);
      const words = parseWordList(context);
      if (words.length === 0) warnings.push('no word list found beside the grid');
      const blank = grid.flat().filter((c) => c === '').length;
      if (blank > 0) warnings.push(`${blank} squares in the wordsearch grid came back empty`);
      return { payload: { grid, words, leftoverIsAnswer: true }, warnings };
    }

    case 'krisskross': {
      if (!lattice) return null;
      const words = parseWordList(context);
      if (words.length === 0) warnings.push('no word bank found beside the grid');
      return { payload: { grid: gridFromLattice(lattice, false), words }, warnings };
    }

    case 'crossword': {
      if (!lattice) return null;
      const grid = gridFromLattice(lattice, false);
      const clues = parseClues(context, grid);
      if (clues.length === 0) warnings.push('no clues parsed — check the ACROSS/DOWN headings');
      return { payload: { grid, clues, cryptic }, warnings };
    }

    case 'wordwheel': {
      const letters = context
        .flatMap((l) => l.text.split(/\s+/))
        .map((t) => t.toUpperCase().replace(/[^A-Z]/g, ''))
        .filter((t) => t.length === 1);
      if (letters.length < 5) return null;
      // The centre letter is conventionally printed first in the ring.
      warnings.push('centre letter guessed as the first single letter found — verify');
      return {
        payload: { centre: letters[0], outer: letters.slice(1), minLength: 4 },
        warnings,
      };
    }

    case 'trivia': {
      const questions = context
        .map((line) => /^(\d{1,2})[.):]\s*(.+)$/.exec(line.text))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => ({ number: Number(m[1]), text: m[2].trim() }));
      if (questions.length === 0) return null;
      return { payload: { questions }, warnings };
    }

    default:
      return null;
  }
}

export interface DetectOptions {
  issueId: string;
  recipe?: Recipe;
  /** Fallback form used when a rule doesn't name one. */
  defaultFormId?: string;
}

export function detectPuzzles(pages: PdfPage[], options: DetectOptions): Puzzle[] {
  const recipe = options.recipe ?? DEFAULT_RECIPE;
  const closesRe = new RegExp(recipe.closesPattern, 'i');
  const prizeRe = new RegExp(recipe.prizePattern, 'i');
  const puzzles: Puzzle[] = [];

  for (const page of pages) {
    const lines = groupLines(page.items);
    if (lines.length === 0) continue;
    const lattices = detectLattices(page);
    const outside = linesOutside(lines, lattices);
    const claimed = new Set<Lattice>();

    for (const rule of recipe.rules) {
      const re = new RegExp(rule.match, 'i');
      // Headings are short: a rule word buried in body copy is not a title.
      const heading = lines.find((l) => re.test(l.text) && l.text.length <= 60);
      if (!heading) continue;

      const available = lattices.filter((l) => !claimed.has(l));
      const lattice = latticeFor(heading, available, rule.minGrid);
      if (lattice) claimed.add(lattice);

      // Context is the prose near the heading: clues, word banks, the coupon.
      // The heading itself is dropped, or "WORDSEARCH" ends up in the word list.
      const context = outside.filter(
        (l) => l !== heading && l.y <= heading.y + heading.height * 2 && !re.test(l.text),
      );

      const built = buildPayload(rule.kind, lattice, context, rule.cryptic);
      if (!built) {
        log.warn(`page ${page.number}: "${heading.text}" looked like ${rule.kind} but had no usable grid`);
        continue;
      }

      const nearby = lines.map((l) => l.text).join(' ');
      const closes = closesRe.exec(nearby);
      const prize = prizeRe.exec(nearby);

      // A wordsearch answer comes from the letters left over after every listed
      // word is struck out, not from shading, so its keyword list stays empty
      // and the solver falls back to the leftovers.
      const usesShading = rule.answerFrom === 'keyword' && rule.kind !== 'wordsearch';
      const keywordCells = lattice && usesShading ? shadedCells(lattice) : [];

      const warnings = [...built.warnings];
      if (usesShading && keywordCells.length === 0) {
        warnings.push('no shaded squares found — nothing to spell the answer with');
      }

      puzzles.push({
        id: idFor(options.issueId, page.number, rule.kind, heading.text),
        issueId: options.issueId,
        page: page.number,
        kind: rule.kind,
        title: heading.text,
        prize: prize?.[1],
        closesAt: closes?.[1],
        entry: {
          formId: rule.formId || options.defaultFormId || '',
          answerFrom: rule.answerFrom,
          keywordCells,
        },
        payload: built.payload,
        warnings,
      });

      log.info(`page ${page.number}: ${rule.kind} — "${heading.text}"${warnings.length ? ` (${warnings.length} warning[s])` : ''}`);
    }
  }

  return puzzles;
}

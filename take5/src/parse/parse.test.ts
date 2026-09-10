import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildPdf, type SynthPage } from './synthPdf.ts';
import { readPdf, type PdfPage } from './pdf.ts';
import { detectLattices, groupLines } from './layout.ts';
import { detectPuzzles } from './detect.ts';
import { solvePuzzle } from '../solve/index.ts';
import { NullOracle } from '../solve/crossword.ts';
import type { CrosswordPayload, WordsearchPayload } from '../types.ts';

/**
 * The wordsearch page. CAT and DOG are hidden in the grid; the letters left
 * over once both are struck out read PRIZEWORDS, which is the answer a real
 * Take 5 wordsearch asks you to post in.
 */
const WORDSEARCH_ROWS = ['CATP', 'DOGR', 'IZEW', 'ORDS'];

const wordsearchPage = (): SynthPage => ({
  width: 400,
  height: 400,
  grids: [
    {
      x: 50,
      y: 200,
      cellSize: 30,
      cells: WORDSEARCH_ROWS.map((row, r) =>
        [...row].map((letter, c) => ({
          text: letter,
          // One tinted square, to prove shading is read back off the page.
          kind: r === 0 && c === 0 ? ('shaded' as const) : ('open' as const),
        })),
      ),
    },
  ],
  texts: [
    { text: 'WORDSEARCH', x: 50, y: 360, size: 16 },
    { text: 'CAT DOG', x: 50, y: 150 },
    { text: 'Entries close 5 August 2026. Win $2,000.', x: 50, y: 100, size: 9 },
  ],
});

/** A 4x4 lattice whose last row and column are blocked, leaving a 3x3 puzzle. */
const crosswordPage = (): SynthPage => ({
  width: 400,
  height: 400,
  grids: [
    {
      x: 50,
      y: 200,
      cellSize: 30,
      cells: Array.from({ length: 4 }, (_, r) =>
        Array.from({ length: 4 }, (_, c) => {
          if (r === 3 || c === 3) return { kind: 'block' as const };
          if ((r === 0 && c === 0) || (r === 1 && c === 1)) return { kind: 'shaded' as const };
          return { kind: 'open' as const };
        }),
      ),
    },
  ],
  texts: [
    { text: 'QUICK CROSSWORD', x: 50, y: 360, size: 16 },
    { text: 'ACROSS', x: 50, y: 180 },
    { text: '1 Feline pet 4 Exist plural 5 Number after nine', x: 50, y: 165 },
    { text: 'DOWN', x: 50, y: 150 },
    { text: '1 Moggie 2 Exist again 3 A round number', x: 50, y: 135 },
  ],
});

let dir = '';
let file = '';
let pages: PdfPage[] = [];

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'take5-parse-'));
  file = path.join(dir, 'issue.pdf');
  await writeFile(file, buildPdf([wordsearchPage(), crosswordPage()]));
  pages = await readPdf(file);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('readPdf returns text runs and filled rectangles for every page', () => {
  assert.equal(pages.length, 2);
  for (const page of pages) {
    assert.equal(Math.round(page.width), 400);
    assert.ok(page.items.length > 0, 'text was extracted');
    assert.ok(page.rects.length >= 16, `expected the grid cells, got ${page.rects.length} rects`);
  }
});

test('lattice detection recovers the grid, its letters and its shading', () => {
  const [lattice] = detectLattices(pages[0]);
  assert.ok(lattice, 'a lattice was found on the wordsearch page');
  assert.equal(lattice.rows, 4);
  assert.equal(lattice.cols, 4);
  assert.ok(Math.abs(lattice.cellSize - 30) < 2, `cell size read as ${lattice.cellSize}`);

  const read = lattice.cells.map((row) => row.map((cell) => cell.text).join(''));
  assert.deepEqual(read, WORDSEARCH_ROWS, 'every letter landed in the right square');
  assert.equal(lattice.cells[0][0].kind, 'shaded');
  assert.equal(lattice.cells[0][1].kind, 'open');
});

test('lattice detection distinguishes blocked squares from open ones', () => {
  const [lattice] = detectLattices(pages[1]);
  assert.ok(lattice);
  assert.equal(lattice.cells[3][3].kind, 'block');
  assert.equal(lattice.cells[0][3].kind, 'block');
  assert.equal(lattice.cells[0][0].kind, 'shaded');
  assert.equal(lattice.cells[2][2].kind, 'open');
});

test('text lines are reassembled in reading order', () => {
  const lines = groupLines(pages[0].items).map((l) => l.text);
  assert.equal(lines[0], 'WORDSEARCH', 'the heading is the topmost line');
  assert.ok(lines.includes('CAT DOG'), `word list line missing from ${JSON.stringify(lines)}`);
});

test('the wordsearch page is recognised, with prize and closing date', () => {
  const puzzles = detectPuzzles([pages[0]], { issueId: 'test' });
  assert.equal(puzzles.length, 1);

  const puzzle = puzzles[0];
  assert.equal(puzzle.kind, 'wordsearch');
  assert.equal(puzzle.page, 1);
  assert.equal(puzzle.prize, '$2,000');
  assert.equal(puzzle.closesAt, '5 August 2026');

  const payload = puzzle.payload as WordsearchPayload;
  assert.deepEqual(payload.grid.map((row) => row.join('')), WORDSEARCH_ROWS);
  assert.deepEqual(payload.words.sort(), ['CAT', 'DOG'], 'the heading did not leak into the word list');
  assert.deepEqual(puzzle.entry?.keywordCells, [], 'a wordsearch answer comes from the leftovers');
});

test('the crossword page is recognised, with blocks, clues and shaded squares', () => {
  const puzzles = detectPuzzles([pages[1]], { issueId: 'test' });
  const puzzle = puzzles.find((p) => p.kind === 'crossword');
  assert.ok(puzzle, 'a crossword was detected');

  const payload = puzzle.payload as CrosswordPayload;
  assert.deepEqual(
    payload.grid.map((row) => row.map((cell) => cell || '.').join('')),
    ['...#', '...#', '...#', '####'],
    'blocked squares became # and the rest are empty',
  );

  assert.deepEqual(
    payload.clues.map((c) => `${c.number}${c.direction[0]}`),
    ['1a', '4a', '5a', '1d', '2d', '3d'],
    'both clue lists parsed, in order',
  );
  assert.equal(payload.clues[0].text, 'Feline pet');
  assert.equal(payload.clues[0].length, 3, 'length came from the grid, not the printed enumeration');

  assert.deepEqual(
    puzzle.entry?.keywordCells,
    [{ r: 0, c: 0 }, { r: 1, c: 1 }],
    'shaded squares become the answer keyword cells',
  );
});

test('the coupon box number is read off the printed heading', async () => {
  const { couponNumberFrom } = await import('./detect.ts');
  assert.equal(couponNumberFrom('12 QUICK CROSSWORD'), 12);
  assert.equal(couponNumberFrom('PUZZLE 7 — CODE CRACKER'), 7);
  assert.equal(couponNumberFrom('3. WORDSEARCH'), 3);
  assert.equal(couponNumberFrom('No. 41 Sudoku'), 41);
  assert.equal(couponNumberFrom('WORDSEARCH'), undefined, 'no number means no box');
  assert.equal(couponNumberFrom('Win $2,000'), undefined, 'a prize is not a puzzle number');
});

test('a heading with no number is flagged rather than guessed', () => {
  const [puzzle] = detectPuzzles([pages[0]], { issueId: 'test' });
  assert.equal(puzzle.entry?.couponNumber, undefined);
  assert.ok(
    puzzle.warnings.some((w) => /coupon box number/.test(w)),
    `expected a coupon-number warning, got ${JSON.stringify(puzzle.warnings)}`,
  );
});

test('an imported wordsearch solves through to the posted answer', async () => {
  const [puzzle] = detectPuzzles([pages[0]], { issueId: 'test' });
  const solution = await solvePuzzle(puzzle, { oracle: NullOracle });

  assert.ok(solution.solved, `solve failed: ${solution.notes.join('; ')}`);
  assert.equal(solution.answer, 'PRIZEWORDS');
  assert.equal(solution.confidence, 1);
});

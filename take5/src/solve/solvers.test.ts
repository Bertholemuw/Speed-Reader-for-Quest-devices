import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Dictionary } from './dictionary.ts';
import { solveSudoku } from './sudoku.ts';
import { solveWordsearch } from './wordsearch.ts';
import { solveCodeword } from './codeword.ts';
import { solveKrisskross } from './krisskross.ts';
import { solveWordwheel } from './wordwheel.ts';
import { solveCrossword, type ClueOracle } from './crossword.ts';
import { extractSlots, numberSlots } from './grid.ts';
import type { Clue, Grid } from '../types.ts';

/**
 * A 3x3 word square used by several tests: every row and every column reads
 * CAT / ARE / TEN, which makes the expected fill unambiguous under a tiny
 * dictionary.
 */
const SQUARE = ['CAT', 'ARE', 'TEN'];
const tinyDict = () => new Dictionary(SQUARE);
const emptyGrid = (rows: number, cols: number): Grid =>
  Array.from({ length: rows }, () => new Array<string>(cols).fill(''));

test('dictionary matches patterns and respects length buckets', () => {
  const dict = new Dictionary(['CAT', 'COT', 'CUT', 'CART', 'DOG']);
  assert.deepEqual([...dict.match('C?T')].sort(), ['CAT', 'COT', 'CUT']);
  assert.deepEqual([...dict.match('CA?T')], ['CART']);
  assert.deepEqual([...dict.match('???')].sort(), ['CAT', 'COT', 'CUT', 'DOG']);
  assert.equal(dict.match('ZZZ').length, 0);
  assert.ok(dict.has('cat'), 'lookup is case-insensitive');
  assert.ok(dict.hasPrefix('CA'));
  assert.ok(!dict.hasPrefix('ZZ'));
});

test('sudoku solves a classic grid and confirms the answer is unique', () => {
  const givens = [
    [5, 3, 0, 0, 7, 0, 0, 0, 0],
    [6, 0, 0, 1, 9, 5, 0, 0, 0],
    [0, 9, 8, 0, 0, 0, 0, 6, 0],
    [8, 0, 0, 0, 6, 0, 0, 0, 3],
    [4, 0, 0, 8, 0, 3, 0, 0, 1],
    [7, 0, 0, 0, 2, 0, 0, 0, 6],
    [0, 6, 0, 0, 0, 0, 2, 8, 0],
    [0, 0, 0, 4, 1, 9, 0, 0, 5],
    [0, 0, 0, 0, 8, 0, 0, 7, 9],
  ];

  const result = solveSudoku(givens);
  assert.ok(result.solved);
  assert.ok(result.unique);
  assert.equal(result.grid![0].join(''), '534678912');
  assert.equal(result.grid![8].join(''), '345286179');

  // Every row, column and box holds 1-9 exactly once.
  for (let i = 0; i < 9; i++) {
    const row = new Set(result.grid![i]);
    const col = new Set(result.grid!.map((r) => r[i]));
    assert.equal(row.size, 9, `row ${i}`);
    assert.equal(col.size, 9, `col ${i}`);
  }
});

test('sudoku reports an ambiguous grid rather than guessing', () => {
  // An empty grid has billions of solutions — it must not come back "unique".
  const blank = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  const result = solveSudoku(blank);
  assert.ok(result.solved);
  assert.equal(result.unique, false);
});

test('sudoku rejects a contradictory grid', () => {
  const bad = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  bad[0][0] = 5;
  bad[0][1] = 5;
  const result = solveSudoku(bad);
  assert.equal(result.solved, false);
  assert.match(result.reason ?? '', /duplicate/);
});

test('wordsearch strikes out the listed words and reads the leftovers', () => {
  const grid: Grid = [
    ['C', 'A', 'T'],
    ['D', 'O', 'G'],
    ['W', 'I', 'N'],
  ];
  const result = solveWordsearch(grid, ['CAT', 'DOG']);
  assert.ok(result.solved);
  assert.deepEqual(result.missing, []);
  assert.equal(result.leftovers, 'WIN');
  assert.equal(result.answer, 'WIN');
});

test('wordsearch finds words running backwards and diagonally', () => {
  const grid: Grid = [
    ['T', 'A', 'C'],
    ['X', 'O', 'X'],
    ['X', 'X', 'G'],
  ];
  // CAT reads right-to-left along row 0; DOG is not present.
  const result = solveWordsearch(grid, ['CAT']);
  assert.ok(result.solved);
  assert.equal(result.placements[0].cells[0].c, 2, 'CAT starts at the right-hand end');
  assert.equal(result.leftovers, 'XOXXXG');
});

test('wordsearch reports words it could not find instead of claiming success', () => {
  const grid: Grid = [
    ['C', 'A', 'T'],
    ['D', 'O', 'G'],
  ];
  const result = solveWordsearch(grid, ['CAT', 'EMU']);
  assert.equal(result.solved, false);
  assert.deepEqual(result.missing, ['EMU']);
  assert.equal(result.answer, null);
});

test('codeword recovers the whole letter mapping with no starter letters', () => {
  // C=1 A=2 T=3 R=4 E=5 N=6, laid out as the CAT/ARE/TEN square.
  const codes = [
    [1, 2, 3],
    [2, 4, 5],
    [3, 5, 6],
  ];
  const result = solveCodeword(codes, {}, tinyDict());
  assert.ok(result.solved, result.reason);
  assert.deepEqual(result.mapping, { 1: 'C', 2: 'A', 3: 'T', 4: 'R', 5: 'E', 6: 'N' });
  assert.deepEqual(
    result.grid!.map((row) => row.join('')),
    SQUARE,
  );
});

test('codeword honours the starter letters it is given', () => {
  const codes = [
    [1, 2, 3],
    [2, 4, 5],
    [3, 5, 6],
  ];
  const wrong = solveCodeword(codes, { 1: 'T' }, tinyDict());
  assert.equal(wrong.solved, false, 'no fill starts CAT-square with T=1');
});

test('codeword refuses a grid with no consistent assignment', () => {
  const codes = [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
  ];
  // Every square the same code means every letter identical — no word qualifies.
  const result = solveCodeword(codes, {}, tinyDict());
  assert.equal(result.solved, false);
});

test('krisskross fits the whole word bank into the grid', () => {
  const result = solveKrisskross(emptyGrid(3, 3), ['CAT', 'ARE', 'TEN', 'CAT', 'ARE', 'TEN']);
  assert.ok(result.solved, result.reason);
  assert.deepEqual(
    result.grid!.map((row) => row.join('')),
    SQUARE,
  );
});

test('krisskross rejects a bank that does not match the slot count', () => {
  const result = solveKrisskross(emptyGrid(3, 3), ['CAT', 'ARE']);
  assert.equal(result.solved, false);
  assert.match(result.reason ?? '', /6 slots but 2 words/);
});

test('grid slot extraction and numbering follow crossword convention', () => {
  const grid: Grid = [
    ['', '', ''],
    ['', '#', ''],
    ['', '', ''],
  ];
  const slots = numberSlots(grid, extractSlots(grid));
  const across = slots.filter((s) => s.direction === 'across');
  const down = slots.filter((s) => s.direction === 'down');

  assert.equal(across.length, 2, 'row 1 is broken by the block, leaving rows 0 and 2');
  assert.equal(down.length, 2, 'column 1 is broken by the block');
  assert.equal(across[0].number, 1);
  assert.equal(down[0].number, 1, '(0,0) starts both an across and a down');
});

test('crossword prefers oracle answers and the grid vetoes the wrong ones', async () => {
  const clues: Clue[] = [
    { number: 1, direction: 'across', text: 'Feline pet', length: 3 },
    { number: 4, direction: 'across', text: 'Exist, plural', length: 3 },
    { number: 5, direction: 'across', text: 'One more than nine', length: 3 },
    { number: 1, direction: 'down', text: 'Moggie', length: 3 },
    { number: 2, direction: 'down', text: 'Are, in another order', length: 3 },
    { number: 3, direction: 'down', text: 'A round number', length: 3 },
  ];

  const oracle: ClueOracle = {
    name: 'stub',
    async suggest() {
      return {
        // The first suggestion for 1-across is wrong; the grid must reject it.
        'across-1': ['DOG', 'CAT'],
        'across-4': ['ARE'],
        'across-5': ['TEN'],
        'down-1': ['CAT'],
        'down-2': ['ARE'],
        'down-3': ['TEN'],
      };
    },
  };

  const result = await solveCrossword(emptyGrid(3, 3), clues, tinyDict(), oracle);
  assert.ok(result.solved, result.reason);
  assert.deepEqual(
    result.grid!.map((row) => row.join('')),
    SQUARE,
  );
  assert.ok(result.confidence > 0.8, `confidence should be high, got ${result.confidence}`);
  assert.deepEqual(result.guessed, [], 'every clue was answered by the oracle');
});

test('crossword still fills the grid when the oracle is useless, but flags it', async () => {
  const clues: Clue[] = [
    { number: 1, direction: 'across', text: 'Feline pet', length: 3 },
    { number: 4, direction: 'across', text: 'Exist, plural', length: 3 },
    { number: 5, direction: 'across', text: 'One more than nine', length: 3 },
  ];
  const silent: ClueOracle = { name: 'silent', async suggest() { return {}; } };

  const result = await solveCrossword(emptyGrid(3, 3), clues, tinyDict(), silent);
  assert.ok(result.solved);
  assert.equal(result.guessed.length, 3, 'all three clues were dictionary guesses');
  assert.ok(result.confidence < 0.5, 'a dictionary-only fill must not look trustworthy');
});

test('crossword survives an oracle that throws', async () => {
  const clues: Clue[] = [{ number: 1, direction: 'across', text: 'Feline pet', length: 3 }];
  const broken: ClueOracle = {
    name: 'broken',
    async suggest() {
      throw new Error('network down');
    },
  };
  const result = await solveCrossword(emptyGrid(3, 3), clues, tinyDict(), broken);
  assert.ok(result.solved, 'an oracle outage degrades to a dictionary fill');
});

test('wordwheel finds the word using every letter', () => {
  const dict = new Dictionary(['CATS', 'CAT', 'ACT', 'SAT']);
  const result = solveWordwheel('A', ['C', 'T', 'S'], dict, 4);
  assert.ok(result.solved);
  assert.equal(result.fullWord, 'CATS');
  assert.equal(result.ambiguous, false);
});

test('wordwheel flags an ambiguous nine-letter answer', () => {
  const dict = new Dictionary(['CATS', 'SCAT', 'ACTS']);
  const result = solveWordwheel('A', ['C', 'T', 'S'], dict, 4);
  assert.ok(result.ambiguous, 'three anagrams all use every letter');
});

test('wordwheel excludes words that skip the centre letter', () => {
  const dict = new Dictionary(['CATS', 'COST']);
  const result = solveWordwheel('A', ['C', 'T', 'S'], dict, 4);
  assert.deepEqual(result.words, ['CATS'], 'COST has no A and reuses unavailable letters');
});

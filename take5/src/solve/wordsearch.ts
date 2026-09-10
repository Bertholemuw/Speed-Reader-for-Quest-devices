import type { Cell, Grid } from '../types.ts';

/**
 * Take 5 wordsearches are prize puzzles because of the leftovers: strike out
 * every listed word and the untouched letters, read left-to-right and top-to-
 * bottom, spell the answer you post in.
 */

const DIRECTIONS: [number, number][] = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export interface Placement {
  word: string;
  cells: Cell[];
}

export interface WordsearchResult {
  solved: boolean;
  placements: Placement[];
  missing: string[];
  /** Letters not covered by any word, in reading order. */
  leftovers: string;
  answer: string | null;
}

function normaliseGrid(grid: Grid): string[][] {
  return grid.map((row) => row.map((cell) => cell.toUpperCase().replace(/[^A-Z]/g, '')));
}

function findWord(grid: string[][], word: string): Cell[] | null {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const target = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (target.length === 0) return null;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== target[0]) continue;
      for (const [dr, dc] of DIRECTIONS) {
        const endR = r + dr * (target.length - 1);
        const endC = c + dc * (target.length - 1);
        if (endR < 0 || endR >= rows || endC < 0 || endC >= cols) continue;

        let hit = true;
        for (let i = 1; i < target.length; i++) {
          if (grid[r + dr * i][c + dc * i] !== target[i]) {
            hit = false;
            break;
          }
        }
        if (!hit) continue;

        const cells: Cell[] = [];
        for (let i = 0; i < target.length; i++) cells.push({ r: r + dr * i, c: c + dc * i });
        return cells;
      }
    }
  }
  return null;
}

export function solveWordsearch(grid: Grid, words: string[]): WordsearchResult {
  const board = normaliseGrid(grid);
  const rows = board.length;
  const cols = board[0]?.length ?? 0;
  const used: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));

  const placements: Placement[] = [];
  const missing: string[] = [];

  // Longest first: a short word is more likely to have a spurious match, and
  // striking the long ones out first keeps those coincidences off the leftovers.
  const ordered = [...words].sort((a, b) => b.length - a.length);

  for (const word of ordered) {
    const cells = findWord(board, word);
    if (!cells) {
      missing.push(word);
      continue;
    }
    placements.push({ word: word.toUpperCase().replace(/[^A-Z]/g, ''), cells });
    for (const { r, c } of cells) used[r][c] = true;
  }

  let leftovers = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!used[r][c] && board[r][c]) leftovers += board[r][c];
    }
  }

  return {
    solved: missing.length === 0,
    placements,
    missing,
    leftovers,
    answer: missing.length === 0 && leftovers.length > 0 ? leftovers : null,
  };
}

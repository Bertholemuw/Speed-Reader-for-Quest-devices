/**
 * Bitmask backtracking with most-constrained-square-first ordering. Fast enough
 * that we always search for a second solution too — a magazine sudoku that
 * admits two answers means the grid was misread, and we would rather report
 * that than post a coin-flip.
 */

const ALL = 0b111_111_111;

export interface SudokuResult {
  solved: boolean;
  grid: number[][] | null;
  unique: boolean;
  reason?: string;
}

function boxOf(r: number, c: number): number {
  return Math.floor(r / 3) * 3 + Math.floor(c / 3);
}

function popcount(n: number): number {
  let count = 0;
  while (n) {
    n &= n - 1;
    count++;
  }
  return count;
}

export function solveSudoku(givens: number[][]): SudokuResult {
  if (givens.length !== 9 || givens.some((row) => row.length !== 9)) {
    return { solved: false, grid: null, unique: false, reason: 'grid is not 9x9' };
  }

  const grid = givens.map((row) => row.slice());
  const rows = new Array<number>(9).fill(0);
  const cols = new Array<number>(9).fill(0);
  const boxes = new Array<number>(9).fill(0);

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const value = grid[r][c];
      if (value === 0) continue;
      if (value < 1 || value > 9) {
        return { solved: false, grid: null, unique: false, reason: `bad value at r${r}c${c}` };
      }
      const bit = 1 << (value - 1);
      const b = boxOf(r, c);
      if (rows[r] & bit || cols[c] & bit || boxes[b] & bit) {
        return { solved: false, grid: null, unique: false, reason: `duplicate ${value} at r${r}c${c}` };
      }
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
    }
  }

  let found: number[][] | null = null;
  let count = 0;

  const search = (): boolean => {
    let bestR = -1;
    let bestC = -1;
    let bestMask = 0;
    let bestCount = 10;

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (grid[r][c] !== 0) continue;
        const mask = ALL & ~(rows[r] | cols[c] | boxes[boxOf(r, c)]);
        const options = popcount(mask);
        if (options === 0) return false; // dead end
        if (options < bestCount) {
          bestCount = options;
          bestMask = mask;
          bestR = r;
          bestC = c;
          if (options === 1) break;
        }
      }
      if (bestCount === 1) break;
    }

    if (bestR === -1) {
      // Every square filled.
      count++;
      if (count === 1) found = grid.map((row) => row.slice());
      return count >= 2; // stop as soon as a second solution proves ambiguity
    }

    const b = boxOf(bestR, bestC);
    for (let value = 1; value <= 9; value++) {
      const bit = 1 << (value - 1);
      if (!(bestMask & bit)) continue;
      grid[bestR][bestC] = value;
      rows[bestR] |= bit;
      cols[bestC] |= bit;
      boxes[b] |= bit;

      if (search()) return true; // bubble the "stop searching" signal up

      grid[bestR][bestC] = 0;
      rows[bestR] &= ~bit;
      cols[bestC] &= ~bit;
      boxes[b] &= ~bit;
    }
    return false;
  };

  search();

  if (count === 0) return { solved: false, grid: null, unique: false, reason: 'no solution' };
  return { solved: true, grid: found, unique: count === 1 };
}

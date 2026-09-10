/**
 * Shared vocabulary for the pipeline:
 *   issue (PDF) -> puzzles -> solutions -> entries -> receipts
 */

export type PuzzleKind =
  | 'sudoku'
  | 'wordsearch'
  | 'codeword'
  | 'krisskross'
  | 'wordwheel'
  | 'crossword'
  | 'trivia'
  | 'unknown';

/** Grid coordinate, row/col both zero-based from the top-left. */
export interface Cell {
  r: number;
  c: number;
}

/** A run of >= 2 consecutive open cells that must hold a dictionary word. */
export interface Slot {
  id: string;
  cells: Cell[];
  direction: 'across' | 'down';
  /** Clue number printed in the magazine, when the puzzle has clues. */
  number?: number;
}

export interface Clue {
  number: number;
  direction: 'across' | 'down';
  text: string;
  length: number;
}

/**
 * `#` is a blocked square, `''` is an empty square to be filled, anything
 * else is a letter already printed in the magazine.
 */
export type Grid = string[][];

export interface SudokuPayload {
  /** 9x9, 0 for an empty square. */
  givens: number[][];
}

export interface WordsearchPayload {
  grid: Grid;
  words: string[];
  /**
   * Take 5 wordsearches hide the prize answer in the letters left over once
   * every listed word is struck out.
   */
  leftoverIsAnswer: boolean;
}

export interface CodewordPayload {
  /** Same shape as the grid; `0` marks a blocked square. */
  codes: number[][];
  /** Starter letters the magazine gives away, e.g. `{ "7": "E" }`. */
  given: Record<string, string>;
}

export interface KrisskrossPayload {
  grid: Grid;
  words: string[];
}

export interface WordwheelPayload {
  centre: string;
  outer: string[];
  minLength: number;
}

export interface CrosswordPayload {
  grid: Grid;
  clues: Clue[];
  /** Set for cryptics so the clue oracle can change tactics. */
  cryptic?: boolean;
}

export interface TriviaPayload {
  questions: { number: number; text: string; options?: string[] }[];
}

export type PuzzlePayload =
  | SudokuPayload
  | WordsearchPayload
  | CodewordPayload
  | KrisskrossPayload
  | WordwheelPayload
  | CrosswordPayload
  | TriviaPayload;

/** How this particular puzzle's prize entry is lodged. */
export interface EntrySpec {
  /** Key into the forms config. */
  formId: string;
  /**
   * Where the submitted answer comes from:
   *  - `keyword`  letters read out of the solved grid at `keywordCells`
   *  - `grid`     the whole solved grid, serialised row-major
   *  - `phrase`   a fixed phrase printed in the magazine
   */
  answerFrom: 'keyword' | 'grid' | 'phrase';
  keywordCells?: Cell[];
  phrase?: string;
  /**
   * Which numbered answer box on the issue's entry coupon this puzzle's answer
   * belongs in. Take 5 lodges one coupon per issue carrying every answer, so
   * without this a solved puzzle has nowhere to go.
   */
  couponNumber?: number;
}

export interface Puzzle {
  id: string;
  issueId: string;
  page: number;
  kind: PuzzleKind;
  title: string;
  prize?: string;
  /** ISO date the competition closes, when the page prints one. */
  closesAt?: string;
  entry?: EntrySpec;
  payload: PuzzlePayload;
  /** Anything the parser was unsure about, surfaced in the dashboard. */
  warnings: string[];
}

export interface Issue {
  id: string;
  /** e.g. "Take 5 — Issue 31, 2026" */
  title: string;
  sourceFile: string;
  importedAt: string;
  puzzles: Puzzle[];
}

export interface Solution {
  puzzleId: string;
  solved: boolean;
  /**
   * 0..1. Deterministic solvers that fully constrained the grid report 1;
   * anything leaning on the clue oracle reports the oracle's own agreement
   * rate so low-confidence entries can be held back.
   */
  confidence: number;
  /** The string that actually goes in the entry form's answer field. */
  answer: string | null;
  grid?: Grid;
  notes: string[];
  solvedAt: string;
}

export type ReceiptStatus = 'submitted' | 'dry-run' | 'failed' | 'skipped';

export interface Receipt {
  puzzleId: string;
  issueId: string;
  formId: string;
  status: ReceiptStatus;
  answer: string | null;
  at: string;
  /** Paths to before/after screenshots kept as proof of what was sent. */
  screenshots: string[];
  message?: string;
}

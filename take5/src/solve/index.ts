import type {
  CodewordPayload,
  CrosswordPayload,
  Grid,
  KrisskrossPayload,
  Puzzle,
  Solution,
  SudokuPayload,
  TriviaPayload,
  WordsearchPayload,
  WordwheelPayload,
} from '../types.ts';
import { logger } from '../logger.ts';
import { sharedDictionary } from './dictionary.ts';
import { readCells } from './grid.ts';
import { solveSudoku } from './sudoku.ts';
import { solveWordsearch } from './wordsearch.ts';
import { solveCodeword } from './codeword.ts';
import { solveKrisskross } from './krisskross.ts';
import { solveWordwheel } from './wordwheel.ts';
import { solveCrossword, NullOracle, type ClueOracle } from './crossword.ts';
import { answerTrivia } from './oracle.ts';

const log = logger('solve');

export interface SolveOptions {
  oracle?: ClueOracle;
  extraWords?: string[];
  geminiModel?: string;
}

/**
 * Turn the solved grid into the string that goes in the entry form. Most Take 5
 * prize puzzles don't want the grid — they want the word spelled out by the
 * shaded squares.
 */
function deriveAnswer(puzzle: Puzzle, grid: Grid | null, fallback: string | null): string | null {
  const spec = puzzle.entry;
  if (!spec) return fallback;

  switch (spec.answerFrom) {
    case 'phrase':
      return spec.phrase ?? fallback;
    case 'keyword': {
      if (!grid || !spec.keywordCells?.length) return fallback;
      const word = readCells(grid, spec.keywordCells).replace(/[^A-Za-z0-9]/g, '');
      return word.length > 0 ? word.toUpperCase() : fallback;
    }
    case 'grid':
      return grid ? grid.map((row) => row.map((cell) => cell || '.').join('')).join('/') : fallback;
    default:
      return fallback;
  }
}

function base(puzzle: Puzzle): Solution {
  return {
    puzzleId: puzzle.id,
    solved: false,
    confidence: 0,
    answer: null,
    notes: [],
    solvedAt: new Date().toISOString(),
  };
}

export async function solvePuzzle(puzzle: Puzzle, options: SolveOptions = {}): Promise<Solution> {
  const dict = sharedDictionary(options.extraWords ?? []);
  const solution = base(puzzle);

  try {
    switch (puzzle.kind) {
      case 'sudoku': {
        const { givens } = puzzle.payload as SudokuPayload;
        const result = solveSudoku(givens);
        if (!result.solved || !result.grid) {
          solution.notes.push(result.reason ?? 'unsolved');
          break;
        }
        const grid: Grid = result.grid.map((row) => row.map(String));
        solution.solved = true;
        solution.grid = grid;
        solution.confidence = result.unique ? 1 : 0.5;
        if (!result.unique) solution.notes.push('grid has more than one solution — likely misread');
        solution.answer = deriveAnswer(puzzle, grid, grid.map((r) => r.join('')).join(''));
        break;
      }

      case 'wordsearch': {
        const payload = puzzle.payload as WordsearchPayload;
        const result = solveWordsearch(payload.grid, payload.words);
        solution.solved = result.solved;
        solution.confidence = result.solved ? 1 : Math.max(0, 1 - result.missing.length / Math.max(1, payload.words.length));
        if (result.missing.length) solution.notes.push(`not found in grid: ${result.missing.join(', ')}`);
        const leftover = payload.leftoverIsAnswer ? result.answer : null;
        solution.answer = deriveAnswer(puzzle, payload.grid, leftover);
        if (payload.leftoverIsAnswer && result.leftovers) {
          solution.notes.push(`leftover letters: ${result.leftovers}`);
        }
        break;
      }

      case 'codeword': {
        const payload = puzzle.payload as CodewordPayload;
        const result = solveCodeword(payload.codes, payload.given, dict);
        if (!result.solved || !result.grid) {
          solution.notes.push(result.reason ?? 'unsolved');
          break;
        }
        const mapped = Object.keys(result.mapping).length;
        solution.solved = true;
        solution.grid = result.grid;
        solution.confidence = mapped >= 26 ? 1 : 0.85;
        if (mapped < 26) solution.notes.push(`only ${mapped}/26 codes appear in the grid`);
        solution.answer = deriveAnswer(puzzle, result.grid, null);
        break;
      }

      case 'krisskross': {
        const payload = puzzle.payload as KrisskrossPayload;
        const result = solveKrisskross(payload.grid, payload.words);
        if (!result.solved || !result.grid) {
          solution.notes.push(result.reason ?? 'unsolved');
          break;
        }
        solution.solved = true;
        solution.grid = result.grid;
        solution.confidence = 1;
        solution.answer = deriveAnswer(puzzle, result.grid, null);
        break;
      }

      case 'wordwheel': {
        const payload = puzzle.payload as WordwheelPayload;
        const result = solveWordwheel(payload.centre, payload.outer, dict, payload.minLength);
        solution.solved = result.solved && result.fullWord !== null;
        solution.confidence = result.ambiguous ? 0.6 : result.fullWord ? 1 : 0;
        if (result.ambiguous) solution.notes.push('more than one word uses every letter');
        solution.notes.push(`${result.words.length} words found`);
        solution.answer = deriveAnswer(puzzle, null, result.fullWord);
        break;
      }

      case 'crossword': {
        const payload = puzzle.payload as CrosswordPayload;
        const oracle = options.oracle ?? NullOracle;
        const result = await solveCrossword(payload.grid, payload.clues, dict, oracle);
        if (!result.solved || !result.grid) {
          solution.notes.push(result.reason ?? 'unsolved');
          break;
        }
        solution.solved = true;
        solution.grid = result.grid;
        solution.confidence = result.confidence;
        if (result.guessed.length) {
          solution.notes.push(`filled from the dictionary without a clue match: ${result.guessed.join('; ')}`);
        }
        solution.answer = deriveAnswer(puzzle, result.grid, null);
        break;
      }

      case 'trivia': {
        const payload = puzzle.payload as TriviaPayload;
        const answers = await answerTrivia(payload.questions, { model: options.geminiModel });
        const ordered = payload.questions.map((q) => answers[q.number] ?? '');
        const complete = ordered.every(Boolean);
        solution.solved = complete;
        // No grid to check these against, so they never reach full confidence.
        solution.confidence = complete ? 0.7 : 0;
        solution.answer = deriveAnswer(puzzle, null, complete ? ordered.join(' | ') : null);
        if (!complete) solution.notes.push('some questions went unanswered');
        break;
      }

      default:
        solution.notes.push(`no solver for puzzle kind "${puzzle.kind}"`);
    }
  } catch (err) {
    solution.notes.push(`solver error: ${(err as Error).message}`);
    log.error(`${puzzle.id} (${puzzle.kind}) threw`, err);
  }

  if (solution.solved && !solution.answer) {
    solution.notes.push('solved, but no answer could be derived — check the entry spec');
  }

  log.info(
    `${puzzle.id} ${puzzle.kind}: ${solution.solved ? 'solved' : 'FAILED'}` +
      ` conf=${solution.confidence.toFixed(2)} answer=${solution.answer ?? '—'}`,
  );
  return solution;
}

export async function solveAll(puzzles: Puzzle[], options: SolveOptions = {}): Promise<Solution[]> {
  const out: Solution[] = [];
  for (const puzzle of puzzles) out.push(await solvePuzzle(puzzle, options));
  return out;
}

export { solveSudoku, solveWordsearch, solveCodeword, solveKrisskross, solveWordwheel, solveCrossword };

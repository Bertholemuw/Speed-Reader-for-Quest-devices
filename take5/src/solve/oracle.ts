import { GoogleGenAI, Type } from '@google/genai';
import { logger } from '../logger.ts';
import type { ClueOracle, ClueRequest } from './crossword.ts';

const log = logger('oracle');

/**
 * Gemini standing in for general knowledge the dictionary doesn't have.
 *
 * It is deliberately asked for *several ranked candidates per clue* rather than
 * one answer: the crossword search treats these as hypotheses and lets the grid
 * throw out the wrong ones, which is far more robust than trusting a single
 * confident-sounding guess.
 */

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    answers: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          key: { type: Type.STRING },
          candidates: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['key', 'candidates'],
      },
    },
  },
  required: ['answers'],
};

function buildPrompt(requests: ClueRequest[], cryptic: boolean): string {
  const lines = requests
    .map((r) => `${r.direction}-${r.number} (${r.length} letters): ${r.text}`)
    .join('\n');

  return [
    cryptic
      ? 'You are solving a cryptic crossword from an Australian magazine.'
      : 'You are solving a quick crossword from an Australian magazine (Take 5).',
    '',
    'For each clue give up to 5 candidate answers, best first.',
    'Rules:',
    '- Every candidate MUST have exactly the stated letter count.',
    '- Letters only, no spaces, hyphens or punctuation. Multi-word answers run together.',
    '- Use Australian/British spelling (COLOUR, not COLOR).',
    '- If you are unsure, still offer your best guesses — a wrong guess is discarded',
    '  by the grid, but an empty list leaves the solver with nothing to work with.',
    '- Reuse the exact key given for each clue.',
    '',
    'Clues:',
    lines,
  ].join('\n');
}

export interface GeminiOracleOptions {
  apiKey?: string;
  model?: string;
  cryptic?: boolean;
  /** Clues per request; large crosswords are split to keep responses complete. */
  batchSize?: number;
}

export function createGeminiOracle(options: GeminiOracleOptions = {}): ClueOracle {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.API_KEY;
  const model = options.model ?? 'gemini-3-flash-preview';
  const batchSize = options.batchSize ?? 30;

  return {
    name: `gemini:${model}`,
    async suggest(requests: ClueRequest[]): Promise<Record<string, string[]>> {
      if (!apiKey) {
        log.warn('no GEMINI_API_KEY set — crossword clues will be filled from the dictionary only');
        return {};
      }
      if (requests.length === 0) return {};

      const ai = new GoogleGenAI({ apiKey });
      const merged: Record<string, string[]> = {};

      for (let start = 0; start < requests.length; start += batchSize) {
        const batch = requests.slice(start, start + batchSize);
        try {
          const response = await ai.models.generateContent({
            model,
            contents: buildPrompt(batch, options.cryptic ?? false),
            config: {
              temperature: 0.3,
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA,
            },
          });

          const text = response.text ?? '';
          const parsed = JSON.parse(text) as { answers?: { key: string; candidates: string[] }[] };
          for (const entry of parsed.answers ?? []) {
            if (!entry?.key || !Array.isArray(entry.candidates)) continue;
            const wanted = batch.find((r) => `${r.direction}-${r.number}` === entry.key);
            const clean = entry.candidates
              .map((c) => String(c).toUpperCase().replace(/[^A-Z]/g, ''))
              .filter((c) => !wanted || c.length === wanted.length);
            if (clean.length > 0) merged[entry.key] = clean;
          }
        } catch (err) {
          // One bad batch shouldn't sink the puzzle; the grid search copes.
          log.warn(`clue batch ${start / batchSize + 1} failed: ${(err as Error).message}`);
        }
      }

      log.info(`oracle answered ${Object.keys(merged).length}/${requests.length} clues`);
      return merged;
    },
  };
}

/** Trivia questions, where there is no grid to check the answer against. */
export async function answerTrivia(
  questions: { number: number; text: string; options?: string[] }[],
  opts: { apiKey?: string; model?: string } = {},
): Promise<Record<number, string>> {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.API_KEY;
  if (!apiKey || questions.length === 0) return {};

  const ai = new GoogleGenAI({ apiKey });
  const prompt = [
    'Answer these Australian magazine trivia questions.',
    'Reply with the answer only — no explanation. If options are listed, reply with',
    'the exact option text.',
    '',
    ...questions.map((q) => {
      const choices = q.options?.length ? ` [options: ${q.options.join(' | ')}]` : '';
      return `${q.number}. ${q.text}${choices}`;
    }),
  ].join('\n');

  try {
    const response = await ai.models.generateContent({
      model: opts.model ?? 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  number: { type: Type.NUMBER },
                  answer: { type: Type.STRING },
                },
                required: ['number', 'answer'],
              },
            },
          },
          required: ['answers'],
        },
      },
    });

    const parsed = JSON.parse(response.text ?? '') as {
      answers?: { number: number; answer: string }[];
    };
    const out: Record<number, string> = {};
    for (const entry of parsed.answers ?? []) out[entry.number] = entry.answer;
    return out;
  } catch (err) {
    log.warn(`trivia answering failed: ${(err as Error).message}`);
    return {};
  }
}

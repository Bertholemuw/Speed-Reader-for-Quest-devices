import { mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CONFIG_DIR, loadForms, loadProfile, loadSettings, type Settings } from './config.ts';
import { logger } from './logger.ts';
import { readPdf } from './parse/pdf.ts';
import { DEFAULT_RECIPE, RecipeSchema, detectPuzzles, type Recipe } from './parse/detect.ts';
import { solveAll } from './solve/index.ts';
import { createGeminiOracle } from './solve/oracle.ts';
import { Store } from './store.ts';
import { Ledger } from './entry/ledger.ts';
import { submitEntries } from './entry/submit.ts';
import type { Issue, Receipt, Solution } from './types.ts';

const log = logger('pipeline');

/** import -> solve -> submit, shared by the CLI, the API and the weekly job. */

export async function loadRecipe(): Promise<Recipe> {
  try {
    const raw = await readFile(path.join(CONFIG_DIR, 'puzzles.json'), 'utf8');
    return RecipeSchema.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_RECIPE;
  }
}

function issueIdFor(file: string): string {
  const stem = path.basename(file).replace(/\.pdf$/i, '');
  const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const hash = createHash('sha1').update(stem).digest('hex').slice(0, 6);
  return `${slug || 'issue'}-${hash}`;
}

export async function importIssue(file: string, settings?: Settings): Promise<Issue> {
  const config = settings ?? (await loadSettings());
  const store = new Store(config.dataDir);
  const recipe = await loadRecipe();

  const id = issueIdFor(file);
  log.info(`importing ${path.basename(file)} as ${id}`);

  const pages = await readPdf(file);
  const puzzles = detectPuzzles(pages, { issueId: id, recipe });

  const issue: Issue = {
    id,
    title: path.basename(file).replace(/\.pdf$/i, ''),
    sourceFile: file,
    importedAt: new Date().toISOString(),
    puzzles,
  };

  await store.saveIssue(issue);

  const flagged = puzzles.filter((p) => p.warnings.length > 0).length;
  log.info(
    `found ${puzzles.length} puzzles across ${pages.length} pages` +
      (flagged ? `, ${flagged} with warnings` : ''),
  );
  if (puzzles.length === 0) {
    log.warn('no puzzles recognised — run `npm run cli -- inspect <pdf>` to see what the parser sees');
  }
  return issue;
}

export async function solveIssue(issue: Issue, settings?: Settings): Promise<Solution[]> {
  const config = settings ?? (await loadSettings());
  const store = new Store(config.dataDir);

  const oracle = createGeminiOracle({ model: config.geminiModel });
  const solutions = await solveAll(issue.puzzles, {
    oracle,
    extraWords: config.extraWords,
    geminiModel: config.geminiModel,
  });

  await store.saveSolutions(issue.id, solutions);

  const solved = solutions.filter((s) => s.solved).length;
  const confident = solutions.filter((s) => s.solved && s.confidence >= config.minConfidence).length;
  log.info(`solved ${solved}/${solutions.length}, ${confident} above the confidence floor`);
  return solutions;
}

export async function submitIssue(
  issue: Issue,
  solutions: Solution[],
  options: { dryRun?: boolean; only?: string[] } = {},
): Promise<Receipt[]> {
  const settings = await loadSettings();
  const [profile, forms] = await Promise.all([loadProfile(), loadForms()]);
  const store = new Store(settings.dataDir);
  await store.init();

  return submitEntries(
    issue,
    solutions,
    { profile, forms, settings, store, ledger: new Ledger(store.ledgerPath) },
    options,
  );
}

export interface RunSummary {
  issues: { id: string; puzzles: number; solved: number; submitted: number; skipped: number; failed: number }[];
  receipts: Receipt[];
}

/**
 * The weekly job: every PDF sitting in the inbox is imported, solved and
 * entered, then moved aside so a second run can't process it again.
 */
export async function runWeekly(options: { dryRun?: boolean } = {}): Promise<RunSummary> {
  const settings = await loadSettings();
  const store = new Store(settings.dataDir);
  await store.init();

  const pending = await store.inbox();
  if (pending.length === 0) {
    log.warn(`nothing to do — drop this week's issue PDF in ${path.join(settings.dataDir, 'inbox')}`);
    return { issues: [], receipts: [] };
  }

  const summary: RunSummary = { issues: [], receipts: [] };
  const processedDir = path.join(store.root, 'processed');
  await mkdir(processedDir, { recursive: true });

  for (const file of pending) {
    try {
      const issue = await importIssue(file, settings);
      const solutions = await solveIssue(issue, settings);
      const receipts = await submitIssue(issue, solutions, { dryRun: options.dryRun });

      summary.receipts.push(...receipts);
      summary.issues.push({
        id: issue.id,
        puzzles: issue.puzzles.length,
        solved: solutions.filter((s) => s.solved).length,
        submitted: receipts.filter((r) => r.status === 'submitted').length,
        skipped: receipts.filter((r) => r.status === 'skipped').length,
        failed: receipts.filter((r) => r.status === 'failed').length,
      });

      await rename(file, path.join(processedDir, path.basename(file)));
      log.info(`finished ${issue.id}; moved ${path.basename(file)} to processed/`);
    } catch (err) {
      // One bad issue must not stop the rest of the inbox.
      log.error(`failed on ${path.basename(file)}: ${(err as Error).message}`);
    }
  }

  return summary;
}

import { chromium, type Browser, type Page } from 'playwright';
import { readProfilePath, type FieldSpec, type FormSpec, type Forms, type Profile, type Settings } from '../config.ts';
import { logger } from '../logger.ts';
import type { Issue, Puzzle, Receipt, Solution } from '../types.ts';
import type { Store } from '../store.ts';
import type { Ledger } from './ledger.ts';

const log = logger('submit');

/**
 * Lodges the entries.
 *
 * Four rules are enforced here rather than left to the caller, because getting
 * any of them wrong has consequences outside this program:
 *
 *  1. A puzzle already in the ledger is never entered again — these comps are
 *     one entry per person and a duplicate can void both.
 *  2. A solution below the confidence floor is held back rather than guessed at.
 *  3. Entries are spaced out and run one at a time, so a weekly run never
 *     arrives as a burst of traffic.
 *  4. Nothing is recorded as submitted unless the page showed a success signal,
 *     and a screenshot of what was sent is kept either way.
 */

export interface SubmitContext {
  profile: Profile;
  forms: Forms;
  settings: Settings;
  store: Store;
  ledger: Ledger;
}

export interface SubmitOptions {
  /** Overrides settings.dryRun for a one-off run. */
  dryRun?: boolean;
  /** Only these puzzle ids, when set. */
  only?: string[];
}

function valueFor(field: FieldSpec, profile: Profile, answer: string): string {
  if (field.from === 'answer') return answer;
  if (field.from.startsWith('profile.')) return readProfilePath(profile, field.from);
  return field.value;
}

async function dismissBanners(page: Page, form: FormSpec): Promise<void> {
  for (const banner of form.dismiss) {
    try {
      const target = page.locator(banner.selector).first();
      if (await target.isVisible({ timeout: 2_000 })) await target.click({ timeout: 5_000 });
    } catch (err) {
      if (!banner.optional) throw err;
    }
  }
}

async function fillField(page: Page, field: FieldSpec, value: string): Promise<void> {
  const target = page.locator(field.selector).first();
  try {
    await target.waitFor({ state: 'visible', timeout: 10_000 });
  } catch (err) {
    if (field.optional) {
      log.debug(`optional field ${field.selector} not present, skipping`);
      return;
    }
    throw new Error(`field not found: ${field.selector}`);
  }

  switch (field.type) {
    case 'select':
      await target.selectOption(value);
      break;
    case 'checkbox':
      if (value === '' || value.toLowerCase() === 'true') await target.check();
      else await target.uncheck();
      break;
    case 'radio':
      await target.check();
      break;
    default:
      await target.fill(value);
  }
}

async function confirmSuccess(page: Page, form: FormSpec): Promise<{ ok: boolean; detail: string }> {
  const { success, timeoutMs } = form;
  const checks: Promise<string>[] = [];

  if (success.selector) {
    checks.push(
      page
        .locator(success.selector)
        .first()
        .waitFor({ state: 'visible', timeout: timeoutMs })
        .then(() => `selector ${success.selector}`),
    );
  }
  if (success.urlContains) {
    checks.push(
      page
        .waitForURL((url) => url.href.includes(success.urlContains), { timeout: timeoutMs })
        .then(() => `url contains ${success.urlContains}`),
    );
  }
  if (success.textContains) {
    checks.push(
      page
        .getByText(success.textContains, { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: timeoutMs })
        .then(() => `text "${success.textContains}"`),
    );
  }

  try {
    // Any one signal is enough — sites vary in which they show.
    const detail = await Promise.any(checks);
    return { ok: true, detail };
  } catch {
    return { ok: false, detail: 'no success signal appeared before the timeout' };
  }
}

async function submitOne(
  browser: Browser,
  puzzle: Puzzle,
  solution: Solution,
  form: FormSpec,
  ctx: SubmitContext,
  dryRun: boolean,
): Promise<Receipt> {
  const receipt: Receipt = {
    puzzleId: puzzle.id,
    issueId: puzzle.issueId,
    formId: puzzle.entry?.formId ?? '',
    status: 'failed',
    answer: solution.answer,
    at: new Date().toISOString(),
    screenshots: [],
  };

  // A fresh context per entry: no cookies carried between forms.
  const context = await browser.newContext({ locale: 'en-AU', timezoneId: ctx.settings.timezone });
  const page = await context.newPage();
  page.setDefaultTimeout(form.timeoutMs);

  try {
    await page.goto(form.url, { waitUntil: 'domcontentloaded', timeout: form.timeoutMs });
    await dismissBanners(page, form);
    await page.locator(form.waitFor).first().waitFor({ state: 'visible', timeout: form.timeoutMs });

    for (const field of form.fields) {
      await fillField(page, field, valueFor(field, ctx.profile, solution.answer ?? ''));
    }

    const before = ctx.store.shotPath(puzzle.id, 'filled');
    await page.screenshot({ path: before, fullPage: true });
    receipt.screenshots.push(before);

    if (dryRun) {
      receipt.status = 'dry-run';
      receipt.message = 'form filled but not submitted (dry run)';
      log.info(`${puzzle.id}: dry run — form filled, not submitted`);
      return receipt;
    }

    await page.locator(form.submit.selector).first().click();
    const outcome = await confirmSuccess(page, form);

    const after = ctx.store.shotPath(puzzle.id, outcome.ok ? 'submitted' : 'unconfirmed');
    await page.screenshot({ path: after, fullPage: true });
    receipt.screenshots.push(after);

    receipt.status = outcome.ok ? 'submitted' : 'failed';
    receipt.message = outcome.detail;
    log[outcome.ok ? 'info' : 'warn'](`${puzzle.id}: ${receipt.status} (${outcome.detail})`);
  } catch (err) {
    receipt.status = 'failed';
    receipt.message = (err as Error).message;
    log.error(`${puzzle.id}: ${receipt.message}`);
    try {
      const shot = ctx.store.shotPath(puzzle.id, 'error');
      await page.screenshot({ path: shot, fullPage: true });
      receipt.screenshots.push(shot);
    } catch {
      // A screenshot of a dead page is not worth another failure.
    }
  } finally {
    await context.close().catch(() => {});
  }

  return receipt;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function submitEntries(
  issue: Issue,
  solutions: Solution[],
  ctx: SubmitContext,
  options: SubmitOptions = {},
): Promise<Receipt[]> {
  const dryRun = options.dryRun ?? ctx.settings.dryRun;
  const byId = new Map(solutions.map((s) => [s.puzzleId, s]));
  const receipts: Receipt[] = [];

  const queue: { puzzle: Puzzle; solution: Solution; form: FormSpec }[] = [];

  for (const puzzle of issue.puzzles) {
    if (options.only && !options.only.includes(puzzle.id)) continue;

    const record = async (status: Receipt['status'], message: string, answer: string | null = null) => {
      const receipt: Receipt = {
        puzzleId: puzzle.id,
        issueId: issue.id,
        formId: puzzle.entry?.formId ?? '',
        status,
        answer,
        at: new Date().toISOString(),
        screenshots: [],
        message,
      };
      receipts.push(receipt);
      if (status !== 'skipped') await ctx.ledger.append(receipt);
      log.info(`${puzzle.id}: ${status} — ${message}`);
    };

    if (await ctx.ledger.hasEntered(puzzle.id)) {
      await record('skipped', 'already entered — competitions are one entry per person');
      continue;
    }

    const solution = byId.get(puzzle.id);
    if (!solution) {
      await record('skipped', 'not solved');
      continue;
    }
    if (!solution.solved) {
      await record('skipped', `solver could not finish this puzzle${solution.notes.length ? `: ${solution.notes[0]}` : ''}`);
      continue;
    }
    if (!solution.answer) {
      await record('skipped', 'solved, but no answer could be derived for the form');
      continue;
    }
    if (solution.confidence < ctx.settings.minConfidence) {
      await record(
        'skipped',
        `confidence ${solution.confidence.toFixed(2)} is below the ${ctx.settings.minConfidence} floor`,
        solution.answer,
      );
      continue;
    }

    const formId = puzzle.entry?.formId;
    const form = formId ? ctx.forms[formId] : undefined;
    if (!form) {
      await record('skipped', formId ? `no form configured as "${formId}"` : 'no entry form set', solution.answer);
      continue;
    }

    queue.push({ puzzle, solution, form });
  }

  if (queue.length === 0) return receipts;

  const capped = queue.slice(0, ctx.settings.maxEntriesPerRun);
  if (capped.length < queue.length) {
    log.warn(`capping this run at ${capped.length} of ${queue.length} entries (maxEntriesPerRun)`);
  }

  log.info(`${dryRun ? 'DRY RUN — ' : ''}lodging ${capped.length} entries, one at a time`);

  const browser = await chromium.launch({ headless: ctx.settings.headless });
  try {
    for (let i = 0; i < capped.length; i++) {
      const { puzzle, solution, form } = capped[i];
      const receipt = await submitOne(browser, puzzle, solution, form, ctx, dryRun);
      receipts.push(receipt);
      await ctx.ledger.append(receipt);

      if (i < capped.length - 1 && ctx.settings.delayBetweenEntriesMs > 0) {
        await sleep(ctx.settings.delayBetweenEntriesMs);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return receipts;
}

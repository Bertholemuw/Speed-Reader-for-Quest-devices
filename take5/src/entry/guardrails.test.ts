import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Ledger } from './ledger.ts';
import { submitEntries } from './submit.ts';
import { Store } from '../store.ts';
import { ProfileSchema, SettingsSchema, type Forms } from '../config.ts';
import type { Issue, Puzzle, Solution } from '../types.ts';

/**
 * These are the rules that stop the app doing something it cannot take back:
 * entering the same competition twice, or posting an answer it isn't sure of.
 * Every case here is rejected before a browser is ever launched, which is why
 * the test can run without one.
 */

const profile = ProfileSchema.parse({
  firstName: 'Test',
  lastName: 'Entrant',
  email: 'test@example.com',
  phone: '0400000000',
  dateOfBirth: '1980-01-01',
  address: { line1: '1 Test St', suburb: 'Sydney', state: 'NSW', postcode: '2000' },
});

const forms: Forms = {
  'online-entry': {
    url: 'https://example.invalid/enter',
    waitFor: 'form',
    dismiss: [],
    fields: [],
    submit: { selector: 'button' },
    success: { selector: '', textContains: 'thanks', urlContains: '' },
    timeoutMs: 5_000,
  },
};

const puzzle = (id: string, formId = 'online-entry'): Puzzle => ({
  id,
  issueId: 'issue-1',
  page: 1,
  kind: 'wordsearch',
  title: id,
  entry: { formId, answerFrom: 'keyword' },
  payload: { grid: [], words: [], leftoverIsAnswer: true },
  warnings: [],
});

const solution = (puzzleId: string, over: Partial<Solution> = {}): Solution => ({
  puzzleId,
  solved: true,
  confidence: 1,
  answer: 'PRIZEWORD',
  notes: [],
  solvedAt: new Date().toISOString(),
  ...over,
});

let dir = '';
let store: Store;
let ledger: Ledger;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'take5-entry-'));
  store = new Store(dir);
  await store.init();
  ledger = new Ledger(store.ledgerPath);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function run(issue: Issue, solutions: Solution[], overrides = {}) {
  const settings = SettingsSchema.parse({ dryRun: true, minConfidence: 0.9, ...overrides });
  return submitEntries(issue, solutions, { profile, forms, settings, store, ledger });
}

test('a puzzle already in the ledger is never entered a second time', async () => {
  await ledger.append({
    puzzleId: 'p1',
    issueId: 'issue-1',
    formId: 'online-entry',
    status: 'submitted',
    answer: 'PRIZEWORD',
    at: new Date().toISOString(),
    screenshots: [],
  });

  const issue: Issue = {
    id: 'issue-1',
    title: 'Issue 1',
    sourceFile: 'x.pdf',
    importedAt: new Date().toISOString(),
    puzzles: [puzzle('p1')],
  };

  const receipts = await run(issue, [solution('p1')]);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].status, 'skipped');
  assert.match(receipts[0].message ?? '', /already entered/);
});

test('an earlier dry run does not count as having entered', async () => {
  await ledger.append({
    puzzleId: 'p1',
    issueId: 'issue-1',
    formId: 'online-entry',
    status: 'dry-run',
    answer: 'PRIZEWORD',
    at: new Date().toISOString(),
    screenshots: [],
  });
  assert.equal(await ledger.hasEntered('p1'), false);
});

test('a low-confidence solution is held back rather than guessed at', async () => {
  const issue: Issue = {
    id: 'issue-1',
    title: 'Issue 1',
    sourceFile: 'x.pdf',
    importedAt: new Date().toISOString(),
    puzzles: [puzzle('p2')],
  };

  const receipts = await run(issue, [solution('p2', { confidence: 0.42 })]);
  assert.equal(receipts[0].status, 'skipped');
  assert.match(receipts[0].message ?? '', /below the 0\.9 floor/);
});

test('an unsolved puzzle and one with no form are both skipped', async () => {
  const issue: Issue = {
    id: 'issue-1',
    title: 'Issue 1',
    sourceFile: 'x.pdf',
    importedAt: new Date().toISOString(),
    puzzles: [puzzle('p3'), puzzle('p4', 'no-such-form'), puzzle('p5', '')],
  };

  const receipts = await run(issue, [
    solution('p3', { solved: false, answer: null }),
    solution('p4'),
    solution('p5'),
  ]);

  assert.equal(receipts.length, 3);
  assert.ok(receipts.every((r) => r.status === 'skipped'));
  assert.match(receipts[0].message ?? '', /solver could not finish/);
  assert.match(receipts[1].message ?? '', /no form configured as "no-such-form"/);
  assert.match(receipts[2].message ?? '', /no entry form set/);
});

test('skips are reported but not written to the ledger', async () => {
  const issue: Issue = {
    id: 'issue-1',
    title: 'Issue 1',
    sourceFile: 'x.pdf',
    importedAt: new Date().toISOString(),
    puzzles: [puzzle('p6')],
  };

  await run(issue, [solution('p6', { confidence: 0.1 })]);
  // A skip is not an entry, so a later run with a better solve can still lodge it.
  assert.equal((await ledger.all()).length, 0);
  assert.equal(await ledger.hasEntered('p6'), false);
});

test('the ledger survives a corrupt line', async () => {
  const { appendFile } = await import('node:fs/promises');
  await appendFile(store.ledgerPath, 'this is not json\n');
  await ledger.append({
    puzzleId: 'p7',
    issueId: 'issue-1',
    formId: 'online-entry',
    status: 'submitted',
    answer: 'X',
    at: new Date().toISOString(),
    screenshots: [],
  });

  const fresh = new Ledger(store.ledgerPath);
  const all = await fresh.all();
  assert.equal(all.length, 1, 'the unreadable line is dropped, the good one survives');
  assert.equal(await fresh.hasEntered('p7'), true);
});

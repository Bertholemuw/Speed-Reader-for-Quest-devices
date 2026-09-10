import assert from 'node:assert/strict';
import { test, before, after, beforeEach, afterEach } from 'node:test';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Ledger } from './ledger.ts';
import { submitEntries } from './submit.ts';
import { Store } from '../store.ts';
import { ProfileSchema, SettingsSchema, readProfilePath, type Forms } from '../config.ts';
import type { Issue, Puzzle, Solution } from '../types.ts';

/**
 * End-to-end coupon submission against a locally hosted form.
 *
 * Take 5 lodges one coupon per issue with a numbered box per puzzle, so this
 * drives the real Playwright submitter against a form shaped like theirs and
 * checks what actually arrived on the wire — the answers in the right boxes,
 * once, and never a second coupon for the same issue.
 */

const profile = ProfileSchema.parse({
  firstName: 'Jane',
  lastName: 'Citizen',
  email: 'jane@example.com',
  phone: '0400000000',
  dateOfBirth: '1975-04-19',
  gender: 'Female',
  address: { line1: '12 Example St', suburb: 'Newtown', state: 'NSW', postcode: '2042' },
});

/** Mirrors the real coupon: numbered answer boxes plus personal details. */
const FORM_HTML = `<!doctype html><html><body>
<form id="entries" method="POST" action="/submit">
  <input name="name_Firstname"><input name="name_Lastname">
  <input name="email"><input name="phone">
  <input name="postal_address"><input name="postal_city">
  <input name="State_and_Country"><input name="postal_code">
  <input name="birth_month_year_Month"><input name="birth_month_year_Year">
  <input name="gender">
  <input name="Puzzle_1"><input name="Puzzle_2"><input name="Puzzle_3">
  <input name="puzzle_34"><input name="puzzle_58">
  <input type="checkbox" name="terms_and_conditions">
  <button type="submit">Enter now</button>
</form></body></html>`;

let server: Server;
let origin = '';
let posted: Record<string, string>[] = [];

before(async () => {
  server = createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        posted.push(Object.fromEntries(new URLSearchParams(body)));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><body><p>Thank you for entering</p></body></html>');
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(FORM_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const forms = (): Forms => ({
  'take5-coupon': {
    url: `${origin}/`,
    frame: '',
    waitFor: 'form#entries',
    dismiss: [],
    puzzleField: 'input[name="puzzle_{n}" i]',
    fields: [
      { selector: 'input[name="name_Firstname"]', from: 'profile.firstName', value: '', type: 'text', optional: false },
      { selector: 'input[name="name_Lastname"]', from: 'profile.lastName', value: '', type: 'text', optional: false },
      { selector: 'input[name="email"]', from: 'profile.email', value: '', type: 'text', optional: false },
      { selector: 'input[name="postal_code"]', from: 'profile.address.postcode', value: '', type: 'text', optional: false },
      { selector: 'input[name="birth_month_year_Month"]', from: 'profile.dateOfBirth.month', value: '', type: 'text', optional: false },
      { selector: 'input[name="birth_month_year_Year"]', from: 'profile.dateOfBirth.year', value: '', type: 'text', optional: false },
      { selector: 'input[name="terms_and_conditions"]', from: 'literal', value: 'true', type: 'checkbox', optional: false },
    ],
    submit: { selector: 'form#entries button[type="submit"]' },
    success: { selector: '', textContains: 'Thank you for entering', urlContains: '' },
    timeoutMs: 20_000,
  },
});

const puzzle = (id: string, couponNumber?: number): Puzzle => ({
  id,
  issueId: 'issue-29',
  page: 1,
  kind: 'wordsearch',
  title: id,
  entry: { formId: 'take5-coupon', answerFrom: 'keyword', couponNumber },
  payload: { grid: [], words: [], leftoverIsAnswer: true },
  warnings: [],
});

const solution = (puzzleId: string, answer: string, over: Partial<Solution> = {}): Solution => ({
  puzzleId,
  solved: true,
  confidence: 1,
  answer,
  notes: [],
  solvedAt: new Date().toISOString(),
  ...over,
});

const issueOf = (puzzles: Puzzle[]): Issue => ({
  id: 'issue-29',
  title: 'Take 5 Issue 29',
  sourceFile: 'issue-29.pdf',
  importedAt: new Date().toISOString(),
  puzzles,
});

let dir = '';
let store: Store;
let ledger: Ledger;

beforeEach(async () => {
  posted = [];
  dir = await mkdtemp(path.join(tmpdir(), 'take5-coupon-'));
  store = new Store(dir);
  await store.init();
  ledger = new Ledger(store.ledgerPath);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const run = (issue: Issue, solutions: Solution[], dryRun: boolean) =>
  submitEntries(issue, solutions, {
    profile,
    forms: forms(),
    settings: SettingsSchema.parse({ dryRun, delayBetweenEntriesMs: 0 }),
    store,
    ledger,
  });

test('date-of-birth splits into the separate boxes coupons ask for', () => {
  assert.equal(readProfilePath(profile, 'profile.dateOfBirth.year'), '1975');
  assert.equal(readProfilePath(profile, 'profile.dateOfBirth.month'), '04');
  assert.equal(readProfilePath(profile, 'profile.dateOfBirth.day'), '19');
  assert.equal(readProfilePath(profile, 'profile.address.suburb'), 'Newtown');
});

test('every answer goes on ONE coupon, in its numbered box', async () => {
  const issue = issueOf([puzzle('p1', 1), puzzle('p2', 3), puzzle('p3', 58)]);
  const receipts = await run(
    issue,
    [solution('p1', 'PRIZEWORDS'), solution('p2', 'CATNIP'), solution('p3', 'LASTONE')],
    false,
  );

  assert.equal(posted.length, 1, 'exactly one submission for the whole issue');
  const body = posted[0];
  assert.equal(body.Puzzle_1, 'PRIZEWORDS');
  assert.equal(body.Puzzle_3, 'CATNIP');
  assert.equal(body.puzzle_58, 'LASTONE', 'the lowercase-named boxes are matched too');
  assert.equal(body.Puzzle_2, '', 'a box with no puzzle is left alone');

  assert.equal(body.name_Firstname, 'Jane');
  assert.equal(body.postal_code, '2042');
  assert.equal(body.birth_month_year_Month, '04');
  assert.equal(body.birth_month_year_Year, '1975');
  assert.equal(body.terms_and_conditions, 'on', 'terms were ticked');

  assert.equal(receipts.length, 3, 'one receipt per puzzle, for the audit trail');
  assert.ok(receipts.every((r) => r.status === 'submitted'));
  assert.ok(receipts.every((r) => r.screenshots.length >= 2));
});

test('a second run will not lodge another coupon for the same issue', async () => {
  const issue = issueOf([puzzle('p1', 1)]);
  await run(issue, [solution('p1', 'PRIZEWORDS')], false);
  assert.equal(posted.length, 1);

  // Same issue, plus a puzzle that was not solved in time for the first run.
  const later = issueOf([puzzle('p1', 1), puzzle('p9', 9)]);
  const receipts = await run(later, [solution('p1', 'PRIZEWORDS'), solution('p9', 'LATECOMER')], false);

  assert.equal(posted.length, 1, 'no second coupon was sent');
  assert.ok(receipts.every((r) => r.status === 'skipped'));
  assert.match(
    receipts.find((r) => r.puzzleId === 'p9')?.message ?? '',
    /already been lodged for this issue/,
  );
});

test('a dry run fills and screenshots the coupon but posts nothing', async () => {
  const issue = issueOf([puzzle('p1', 1)]);
  const receipts = await run(issue, [solution('p1', 'PRIZEWORDS')], true);

  assert.equal(posted.length, 0, 'nothing reached the server');
  assert.equal(receipts[0].status, 'dry-run');
  assert.ok(receipts[0].screenshots.length >= 1);
  assert.equal(await ledger.hasEnteredIssue('issue-29', 'take5-coupon'), false);
});

test('a puzzle with no coupon box number is skipped, not silently dropped', async () => {
  const issue = issueOf([puzzle('p1', 1), puzzle('pX')]);
  const receipts = await run(issue, [solution('p1', 'PRIZEWORDS'), solution('pX', 'NOWHERE')], false);

  const skipped = receipts.find((r) => r.puzzleId === 'pX');
  assert.equal(skipped?.status, 'skipped');
  assert.match(skipped?.message ?? '', /no coupon box number/);
  assert.equal(posted.length, 1, 'the rest of the issue still went in');
  assert.equal(posted[0].Puzzle_1, 'PRIZEWORDS');
});

test('a low-confidence answer is left off the coupon', async () => {
  const issue = issueOf([puzzle('p1', 1), puzzle('p2', 3)]);
  await run(
    issue,
    [solution('p1', 'PRIZEWORDS'), solution('p2', 'MAYBE', { confidence: 0.3 })],
    false,
  );

  assert.equal(posted.length, 1);
  assert.equal(posted[0].Puzzle_1, 'PRIZEWORDS');
  assert.equal(posted[0].Puzzle_3, '', 'the uncertain answer was not written');
});

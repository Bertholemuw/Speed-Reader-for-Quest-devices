import express from 'express';
import { loadSettings } from './config.ts';
import { logger } from './logger.ts';
import { runWeekly, solveIssue, submitIssue } from './pipeline.ts';
import { Store } from './store.ts';
import { Ledger } from './entry/ledger.ts';

const log = logger('server');

/**
 * Read/act API behind the dashboard. Bound to localhost by default: it can
 * submit competition entries and holds the entrant's address, so it has no
 * business listening on a network interface.
 */
const app = express();
app.use(express.json({ limit: '2mb' }));

const settings = await loadSettings();
const store = new Store(settings.dataDir);
const ledger = new Ledger(store.ledgerPath);
await store.init();

app.get('/api/status', async (_req, res) => {
  const issues = await store.listIssues();
  res.json({
    dryRun: settings.dryRun,
    minConfidence: settings.minConfidence,
    cron: settings.cron,
    timezone: settings.timezone,
    inbox: (await store.inbox()).length,
    issues: issues.length,
    entries: (await ledger.all()).filter((r) => r.status === 'submitted').length,
  });
});

app.get('/api/issues', async (_req, res) => {
  const issues = await store.listIssues();
  res.json(
    issues.map((issue) => ({
      id: issue.id,
      title: issue.title,
      importedAt: issue.importedAt,
      puzzles: issue.puzzles.length,
      warnings: issue.puzzles.reduce((n, p) => n + p.warnings.length, 0),
    })),
  );
});

app.get('/api/issues/:id', async (req, res) => {
  const issue = await store.loadIssue(req.params.id);
  if (!issue) {
    res.status(404).json({ error: 'no such issue' });
    return;
  }
  res.json({
    issue,
    solutions: await store.loadSolutions(issue.id),
    receipts: await ledger.forIssue(issue.id),
  });
});

app.post('/api/issues/:id/solve', async (req, res) => {
  const issue = await store.loadIssue(req.params.id);
  if (!issue) {
    res.status(404).json({ error: 'no such issue' });
    return;
  }
  res.json({ solutions: await solveIssue(issue, settings) });
});

app.post('/api/issues/:id/submit', async (req, res) => {
  const issue = await store.loadIssue(req.params.id);
  if (!issue) {
    res.status(404).json({ error: 'no such issue' });
    return;
  }
  const solutions = await store.loadSolutions(issue.id);
  if (solutions.length === 0) {
    res.status(409).json({ error: 'solve the issue first' });
    return;
  }
  // Live submission has to be asked for explicitly, every time.
  const dryRun = req.body?.live === true ? false : true;
  res.json({ receipts: await submitIssue(issue, solutions, { dryRun, only: req.body?.only }) });
});

app.post('/api/run', async (req, res) => {
  res.json(await runWeekly({ dryRun: req.body?.live === true ? false : true }));
});

app.get('/api/ledger', async (_req, res) => {
  res.json(await ledger.all());
});

const port = Number(process.env.TAKE5_PORT ?? 4173);
app.listen(port, '127.0.0.1', () => {
  log.info(`listening on http://127.0.0.1:${port} (dryRun=${settings.dryRun})`);
});

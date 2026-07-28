import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSettings } from './config.ts';
import { logger } from './logger.ts';
import { importIssue, loadRecipe, runWeekly, solveIssue, submitIssue } from './pipeline.ts';
import { readPdf } from './parse/pdf.ts';
import { detectPuzzles } from './parse/detect.ts';
import { detectLattices, groupLines } from './parse/layout.ts';
import { describeForm } from './entry/recorder.ts';
import { Store } from './store.ts';
import { Ledger } from './entry/ledger.ts';

const log = logger('cli');

const USAGE = `
take5 — solve a Take 5 issue and lodge the entries

  import <file.pdf>          read an issue and save the puzzles it finds
  solve  <issueId>           solve every puzzle in an imported issue
  submit <issueId> [--live]  lodge the entries (dry run unless --live)
  run [--live]               import + solve + submit everything in the inbox
  issues                     list imported issues
  ledger [issueId]           show what has been entered

  inspect <file.pdf> [--page N]   dump what the parser sees on a page
  record  <url> [--headed]        draft a forms.json entry from a live page

Dry run is the default everywhere. Nothing is ever submitted without --live.
`;

function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function cmdInspect(file: string, pageNumber?: number): Promise<void> {
  const pages = await readPdf(file);
  const recipe = await loadRecipe();
  const wanted = pageNumber ? pages.filter((p) => p.number === pageNumber) : pages;

  for (const page of wanted) {
    const lines = groupLines(page.items);
    const lattices = detectLattices(page);
    if (lines.length === 0 && lattices.length === 0) continue;

    console.log(`\n=== page ${page.number} (${Math.round(page.width)}x${Math.round(page.height)}) ===`);
    console.log(`${page.items.length} text runs, ${page.rects.length} filled shapes`);

    for (const lattice of lattices) {
      console.log(`\n  grid ${lattice.rows}x${lattice.cols} @ cell ${lattice.cellSize.toFixed(1)}pt`);
      for (const row of lattice.cells) {
        const rendered = row
          .map((cell) => {
            if (cell.kind === 'block') return '##';
            const text = cell.text.replace(/\s/g, '').slice(0, 2) || '.';
            return (cell.kind === 'shaded' ? `*${text.slice(0, 1)}` : text).padEnd(2);
          })
          .join(' ');
        console.log(`    ${rendered}`);
      }
      console.log('    (## blocked, *x shaded/answer square, . empty)');
    }

    console.log('\n  text lines:');
    for (const line of lines.slice(0, 60)) {
      console.log(`    ${line.text.slice(0, 110)}`);
    }
    if (lines.length > 60) console.log(`    ... ${lines.length - 60} more`);
  }

  const puzzles = detectPuzzles(wanted, { issueId: 'inspect', recipe });
  console.log(`\n=== recognised ${puzzles.length} puzzle(s) ===`);
  for (const puzzle of puzzles) {
    console.log(`  p${puzzle.page} ${puzzle.kind.padEnd(11)} "${puzzle.title}"`);
    console.log(`      answer squares: ${puzzle.entry?.keywordCells?.length ?? 0}`);
    for (const warning of puzzle.warnings) console.log(`      ! ${warning}`);
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const settings = await loadSettings();
  const store = new Store(settings.dataDir);

  switch (command) {
    case 'import': {
      const file = args[0];
      if (!file) throw new Error('usage: import <file.pdf>');
      const issue = await importIssue(path.resolve(file), settings);
      console.log(`imported ${issue.id} — ${issue.puzzles.length} puzzles`);
      for (const puzzle of issue.puzzles) {
        console.log(`  ${puzzle.id.padEnd(24)} ${puzzle.kind.padEnd(11)} p${puzzle.page}  ${puzzle.title}`);
        for (const warning of puzzle.warnings) console.log(`      ! ${warning}`);
      }
      break;
    }

    case 'solve': {
      const issue = await store.loadIssue(args[0] ?? '');
      if (!issue) throw new Error(`unknown issue "${args[0]}" — try: issues`);
      const solutions = await solveIssue(issue, settings);
      for (const solution of solutions) {
        const mark = solution.solved ? '✓' : '✗';
        console.log(`  ${mark} ${solution.puzzleId.padEnd(24)} ${solution.confidence.toFixed(2)}  ${solution.answer ?? '—'}`);
        for (const note of solution.notes) console.log(`      · ${note}`);
      }
      break;
    }

    case 'submit': {
      const issue = await store.loadIssue(args[0] ?? '');
      if (!issue) throw new Error(`unknown issue "${args[0]}" — try: issues`);
      const solutions = await store.loadSolutions(issue.id);
      if (solutions.length === 0) throw new Error('no solutions saved — run: solve ' + issue.id);
      const receipts = await submitIssue(issue, solutions, { dryRun: !flag(args, 'live') });
      for (const receipt of receipts) {
        console.log(`  ${receipt.status.padEnd(10)} ${receipt.puzzleId.padEnd(24)} ${receipt.answer ?? '—'}`);
        if (receipt.message) console.log(`      ${receipt.message}`);
      }
      break;
    }

    case 'run': {
      const summary = await runWeekly({ dryRun: !flag(args, 'live') });
      for (const issue of summary.issues) {
        console.log(
          `${issue.id}: ${issue.puzzles} puzzles, ${issue.solved} solved, ` +
            `${issue.submitted} submitted, ${issue.skipped} skipped, ${issue.failed} failed`,
        );
      }
      if (summary.issues.length === 0) console.log('nothing in the inbox');
      break;
    }

    case 'issues': {
      const issues = await store.listIssues();
      if (issues.length === 0) console.log('no issues imported yet');
      for (const issue of issues) {
        console.log(`  ${issue.id.padEnd(28)} ${issue.puzzles.length} puzzles  ${issue.importedAt.slice(0, 10)}`);
      }
      break;
    }

    case 'ledger': {
      const ledger = new Ledger(store.ledgerPath);
      const receipts = args[0] ? await ledger.forIssue(args[0]) : await ledger.all();
      if (receipts.length === 0) console.log('nothing entered yet');
      for (const receipt of receipts) {
        console.log(`  ${receipt.at.slice(0, 16)}  ${receipt.status.padEnd(10)} ${receipt.puzzleId.padEnd(24)} ${receipt.answer ?? '—'}`);
      }
      break;
    }

    case 'inspect': {
      const file = args[0];
      if (!file) throw new Error('usage: inspect <file.pdf> [--page N]');
      const page = option(args, 'page');
      await cmdInspect(path.resolve(file), page ? Number(page) : undefined);
      break;
    }

    case 'record': {
      const url = args[0];
      if (!url) throw new Error('usage: record <url> [--headed]');
      const { fields, draft } = await describeForm(url, !flag(args, 'headed'));
      console.log('\nfields found:');
      for (const field of fields) {
        console.log(`  ${field.selector.padEnd(30)} ${field.type.padEnd(9)} ${field.label || field.placeholder || field.name}`);
      }
      const out = path.join(store.root, 'form-draft.json');
      await store.init();
      await writeFile(out, JSON.stringify({ 'REPLACE-WITH-FORM-ID': draft }, null, 2));
      console.log(`\ndraft written to ${out}`);
      console.log('Check every mapping, then merge it into config/forms.json.');
      break;
    }

    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((err) => {
  log.error((err as Error).message);
  process.exitCode = 1;
});

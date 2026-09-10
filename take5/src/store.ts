import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './config.ts';
import type { Issue, Solution } from './types.ts';

/** Flat JSON on disk — a week of puzzles is small, and it stays inspectable. */

export class Store {
  readonly root: string;

  constructor(dataDir: string) {
    this.root = path.isAbsolute(dataDir) ? dataDir : path.join(ROOT, dataDir);
  }

  private dir(...parts: string[]): string {
    return path.join(this.root, ...parts);
  }

  async init(): Promise<void> {
    await Promise.all(
      ['inbox', 'issues', 'solutions', 'shots'].map((d) => mkdir(this.dir(d), { recursive: true })),
    );
  }

  async saveIssue(issue: Issue): Promise<void> {
    await this.init();
    await writeFile(this.dir('issues', `${issue.id}.json`), JSON.stringify(issue, null, 2));
  }

  async loadIssue(id: string): Promise<Issue | null> {
    try {
      return JSON.parse(await readFile(this.dir('issues', `${id}.json`), 'utf8')) as Issue;
    } catch {
      return null;
    }
  }

  async listIssues(): Promise<Issue[]> {
    await this.init();
    const files = (await readdir(this.dir('issues'))).filter((f) => f.endsWith('.json'));
    const issues: Issue[] = [];
    for (const file of files) {
      try {
        issues.push(JSON.parse(await readFile(this.dir('issues', file), 'utf8')) as Issue);
      } catch {
        // A half-written file shouldn't take the whole listing down.
      }
    }
    return issues.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  async saveSolutions(issueId: string, solutions: Solution[]): Promise<void> {
    await this.init();
    await writeFile(this.dir('solutions', `${issueId}.json`), JSON.stringify(solutions, null, 2));
  }

  async loadSolutions(issueId: string): Promise<Solution[]> {
    try {
      return JSON.parse(await readFile(this.dir('solutions', `${issueId}.json`), 'utf8')) as Solution[];
    } catch {
      return [];
    }
  }

  /** PDFs waiting to be imported, oldest first. */
  async inbox(): Promise<string[]> {
    await this.init();
    const files = await readdir(this.dir('inbox'));
    return files
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .sort()
      .map((f) => this.dir('inbox', f));
  }

  shotPath(puzzleId: string, stage: string): string {
    return this.dir('shots', `${puzzleId}-${stage}-${Date.now()}.png`);
  }

  get ledgerPath(): string {
    return this.dir('ledger.jsonl');
  }
}

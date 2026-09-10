import { appendFile, readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Receipt } from '../types.ts';

/**
 * Append-only record of every entry the app has lodged.
 *
 * This is the guard against double-entering. Nearly every Take 5 competition is
 * one entry per person, so a re-run after a crash — or a weekly job that fires
 * twice — must not post the same puzzle again. The ledger is consulted before
 * anything is submitted, and written the moment it is.
 */
export class Ledger {
  private cache: Receipt[] | null = null;

  constructor(private readonly file: string) {}

  async all(): Promise<Receipt[]> {
    if (this.cache) return this.cache;
    try {
      const text = await readFile(this.file, 'utf8');
      this.cache = text
        .split('\n')
        .filter((line) => line.trim())
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as Receipt];
          } catch {
            return [];
          }
        });
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  async append(receipt: Receipt): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(receipt)}\n`);
    if (this.cache) this.cache.push(receipt);
  }

  /** True once a puzzle has actually been lodged; dry runs don't count. */
  async hasEntered(puzzleId: string): Promise<boolean> {
    return (await this.all()).some((r) => r.puzzleId === puzzleId && r.status === 'submitted');
  }

  /**
   * True once any coupon has been lodged for this issue. Take 5 allows a single
   * online entry per issue, so a second coupon would put the first at risk.
   */
  async hasEnteredIssue(issueId: string, formId: string): Promise<boolean> {
    return (await this.all()).some(
      (r) => r.issueId === issueId && r.formId === formId && r.status === 'submitted',
    );
  }

  async forIssue(issueId: string): Promise<Receipt[]> {
    return (await this.all()).filter((r) => r.issueId === issueId);
  }
}

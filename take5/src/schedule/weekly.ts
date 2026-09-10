import cron from 'node-cron';
import { loadSettings } from '../config.ts';
import { logger } from '../logger.ts';
import { runWeekly } from '../pipeline.ts';

const log = logger('schedule');

/**
 * The unattended weekly run.
 *
 * `dryRun` in settings.json is honoured here, and it ships true — a fresh
 * install will fill forms and screenshot them without submitting until you
 * have checked the screenshots and turned it off deliberately.
 */
async function main(): Promise<void> {
  const settings = await loadSettings();

  if (!cron.validate(settings.cron)) {
    log.error(`"${settings.cron}" is not a valid cron expression`);
    process.exitCode = 1;
    return;
  }

  let running = false;

  const task = cron.schedule(
    settings.cron,
    async () => {
      if (running) {
        log.warn('previous run is still going — skipping this tick');
        return;
      }
      running = true;
      const started = Date.now();
      try {
        const summary = await runWeekly({ dryRun: settings.dryRun });
        const submitted = summary.receipts.filter((r) => r.status === 'submitted').length;
        const failed = summary.receipts.filter((r) => r.status === 'failed').length;
        log.info(
          `run finished in ${Math.round((Date.now() - started) / 1000)}s: ` +
            `${summary.issues.length} issue(s), ${submitted} submitted, ${failed} failed`,
        );
      } catch (err) {
        log.error(`weekly run threw: ${(err as Error).message}`);
      } finally {
        running = false;
      }
    },
    { timezone: settings.timezone },
  );

  log.info(`scheduled "${settings.cron}" (${settings.timezone}); dryRun=${settings.dryRun}`);
  log.info('waiting — drop each issue PDF into the inbox and leave this running');

  const stop = () => {
    log.info('shutting down');
    task.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  log.error((err as Error).message);
  process.exitCode = 1;
});

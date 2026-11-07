import { closePool } from '../src/db/client.js';
import { migratePlatformQrs } from '../src/modules/billing/platform-qr-migration.js';
import { retryFailedPlatformQrCleanup } from '../src/modules/billing/platform-qr-cleanup.js';

const args = process.argv.slice(2);
const mode = args[0];
if ((mode !== '--copy' || args.length !== 1) && (mode !== '--retry-cleanup' || args.length !== 1) && (mode !== '--finalize' || args.length !== 2 || args[1] !== '--confirmed-readers-upgraded')) {
  process.stderr.write('Usage: migrate-platform-payment-qrs --copy | --finalize --confirmed-readers-upgraded | --retry-cleanup\n');
  process.exitCode = 2;
} else {
  try {
    if (mode === '--retry-cleanup') {
      const count = await retryFailedPlatformQrCleanup();
      process.stdout.write(`Platform QR cleanup: requeued ${count} failed objects.\n`);
    } else {
      const result = await migratePlatformQrs(mode === '--copy' ? 'copy' : 'finalize');
      process.stdout.write(`Platform QR migration: scanned ${result.scanned}, updated ${result.changed}.\n`);
    }
  } catch {
    process.stderr.write('Platform QR migration failed; no failing image was finalized. Fix the configuration or data and retry.\n');
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

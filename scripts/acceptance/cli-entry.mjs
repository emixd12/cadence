// Shared run-as-script check for the acceptance CLIs (Tickets 247, 248, 250, 254).
//
// `import.meta.url` is the module's real path, but `process.argv[1]` keeps the
// path the user typed. Comparing them directly fails through a symlink (for
// example /tmp on macOS), and the CLI then exits 0 without running. For the
// watcher that exit means "satisfied". This compares real paths instead, and
// fails loudly if Node reports the module as the entry point but the paths
// still disagree.
import { realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const real = (path) => {
  try { return realpathSync(path); } catch { return null; }
};

/**
 * True when the module with `meta` (its `import.meta`) is the command being run.
 * When `meta.main` is true but the real paths differ, writes one line to stderr,
 * sets exit code 70 and returns false, so the CLI never exits 0 silently.
 */
export function isCliEntry(meta, { argv1 = process.argv[1], stderr = process.stderr, setExitCode = (code) => { process.exitCode = code; } } = {}) {
  const self = fileURLToPath(meta.url);
  const entry = argv1 ? real(argv1) : null;
  if (entry !== null && entry === real(self)) return true;
  if (meta.main === true) {
    stderr.write(`${basename(self)}: could not confirm this file is the command being run; it did not run\n`);
    setExitCode(70);
  }
  return false;
}

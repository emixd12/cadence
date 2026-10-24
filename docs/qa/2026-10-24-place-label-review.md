# Ticket 216 merge review — October 24, 2026

## Complete retained-history reads

`supabase/config.toml` limits a Data API response to 1,000 rows.
`readCompletionPlaceLabelRows` requested one oldest-first response. Accounts
with more retained history lost their newest labels before the suggestion
resolver ran. The combined travel release also uses this reader for Daily
Brief history counts.

All unbounded collection reads in `placeLabels.repo.ts` now use the existing
`readAllPostgrestRows` helper. Each read retains its owner filter and includes
the unique ID in its ordering. The helper rejects later-page failures,
duplicate pages and its existing absolute ceiling instead of returning an
apparently complete partial history.

`tests/place-labels.repo.test.ts` covers all four collection readers, a real
Where suggestion after 1,000 older labels, and a failed later page.

## Concurrent opt-out

The hosted `require_place_labels_enabled` trigger previously read the enabled
setting without locking it. Under PostgreSQL's normal Read Committed isolation,
this interleaving retained data after opt-out:

1. Session A starts a transaction and sets `enabled = false`. Its cleanup
   trigger deletes existing labels, markers and dismissals. A has not committed.
2. Session B inserts a dependent row. Its trigger sees the previously committed
   enabled setting, permits the insert, and B commits.
3. Session A commits. The setting is off, but B's inserted row remains.

The correction uses `SELECT ... FOR SHARE` through PL/pgSQL `PERFORM` and checks
`FOUND`. A dependent writer now waits for an overlapping settings update. After
opt-out commits, the writer rechecks the row and rejects the write. If the
dependent writer holds the share lock first, opt-out waits, then clears the
committed row.

### Executed database regression in the original review workspace

An isolated PostgreSQL 17.10 cluster used only a private Unix socket. It held
minimal synthetic settings and dependent tables. The test extracted the exact
`require_place_labels_enabled` and `clear_place_labels_on_disable` definitions
from the migration. Three independent database connections controlled the order
and observed lock waits through `pg_stat_activity`.

| Trigger | Concurrent dependent write | Result after opt-out |
| --- | --- | --- |
| Original | Place marker | One row survived |
| Original | Completion label | One row survived |
| Original | Suggestion dismissal | One row survived |
| Corrected | Place marker | Rejected; zero rows |
| Corrected | Completion label | Rejected; zero rows |
| Corrected | Suggestion dismissal | Rejected; zero rows |
| Corrected | Marker commits before opt-out | Opt-out waited, then deleted it |

This proves the changed trigger's concurrency contract. It does not replace
the full Supabase migration rehearsal, RLS smoke or installed desktop checks.
Those remain separate release gates. The migration is still unshipped; no
applied migration or hosted database was changed.

## Validation and workspace recovery

The original review workspace completed these checks before an unexpected
scratch-environment reset removed its working files and logs:

- Focused pagination, resolver and service tests: 47 passed.
- All six pagination regression tests failed against the original reader and
  passed against the correction.
- `agents:check`, `interactions:check`, `resolvers:check` and `typecheck`: passed.
- Full ESLint and `git diff --check`: passed.
- Full Vitest suite: 3,525 passed, 169 skipped across 327 passing and 15 skipped
  files. These skips were the suite's existing configured skips.
- Production web build: passed.
- The PostgreSQL regression above passed; the temporary server was stopped.

The production corrections were reconstructed against the same original PR
head, `05e6cf7d1b96fbcaefff6e0d3bb6b8df7fed181f`, and the six regression tests
were recreated. The preceding results describe the actual earlier run, not a
new execution after recovery. Validation of the reconstructed commit is
reported separately in the merge-review handoff and CI.

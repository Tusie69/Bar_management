-- TU-38 — index for the operating-day range the turn statistics read.
--
-- Every turn aggregate starts from the `target_visits` CTE in table-turn.repository.ts:
--   WHERE organization_id = ? AND venue_id = ? AND business_date BETWEEN ? AND ?
-- The existing indexes each serve only part of that: ix_visits_org_venue (organization_id,
-- venue_id) has the two equalities but no date, so the whole venue's history is read and the
-- month is filtered afterwards; ix_visits_venue_date (venue_id, business_date) has the range
-- but misses organization_id.
--
-- This index carries both equalities and then the range, so one month is a covering index
-- range scan whose size is the month rather than the venue's whole history. Measured on a
-- three-month sample (5 380 visits, 5 400 turns), EXPLAIN FORMAT=TREE reports
-- `Covering index range scan on visits using ix_visits_org_venue_date ... rows=1800` when
-- the index is used, against `Index lookup on visits using ix_visits_org_venue ... rows=2690`
-- for the plan the optimizer picks unaided at that size — it still prefers the narrower
-- two-column index, because scanning half of a small table costs less than a wider index.
-- The margin moves the other way as the ledger accumulates years: ix_visits_org_venue grows
-- with the venue's whole history while this one stays the size of the month asked for. The
-- index is therefore here for the volume this report is meant to survive, and the benchmark
-- prints both plans (test/tu38-turn-statistics-benchmark.mysql.test.ts) rather than
-- asserting which one the optimizer chooses.
--
-- Safety: ADD INDEX only, on a table whose rows are untouched. MySQL 8+ builds a secondary
-- index online (ALGORITHM=INPLACE, LOCK=NONE), so concurrent reads and writes continue; it
-- is declared explicitly so the migration fails loudly rather than silently locking the
-- table if a future engine cannot do it online. No column, row or constraint changes, so
-- TU-25, Booking/Visit and NA-34 behaviour is unchanged.
ALTER TABLE visits
  ADD KEY ix_visits_org_venue_date (organization_id, venue_id, business_date),
  ALGORITHM=INPLACE, LOCK=NONE;

-- migrate:down
-- irreversible: migrations are forward-only (doc 10 §2). Fix forward or restore a backup.

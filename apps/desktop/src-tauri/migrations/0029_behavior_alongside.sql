-- The person's alongside answer (hosted migrations 20261125140000_behavior_alongside and
-- 20261126220000_account_sync_alongside; D33, Ticket 363). NULL is unanswered, 1 is yes,
-- 0 is no. Existing rows become unanswered. Model guesses are never stored here: a linked
-- Mac reads them from the hosted server and keeps them in memory only.

ALTER TABLE behaviors ADD COLUMN alongside INTEGER
CHECK (alongside IS NULL OR alongside IN (0, 1));

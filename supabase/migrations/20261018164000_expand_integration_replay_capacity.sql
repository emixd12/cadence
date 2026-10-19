begin;

-- The 100,000-byte wire limit excludes JSONB separator and numeric expansion.
alter table cadence_oauth_private.idempotency_records
  drop constraint idempotency_records_result_check,
  add constraint idempotency_records_result_check
    check (result is null or octet_length(result::text) <= 524288);

commit;

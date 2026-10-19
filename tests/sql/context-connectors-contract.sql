\set ON_ERROR_STOP on
-- Ticket 235 connector lifecycle contract. Synthetic owners and ciphertext only.
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('22200000-0000-4000-8000-000000000001','authenticated','authenticated','connector-one@example.invalid','{}','{}'),
('22200000-0000-4000-8000-000000000002','authenticated','authenticated','connector-two@example.invalid','{}','{}');
insert into auth.identities(provider_id,user_id,identity_data,provider)
values('connector-two-google','22200000-0000-4000-8000-000000000002','{"sub":"connector-two-google"}','google');

create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if position(expected in sqlerrm) = 0 and sqlstate <> expected then raise exception 'unexpected error for %: % %', statement, sqlstate, sqlerrm; end if;
    return;
  end;
  raise exception 'expected failure: %', statement;
end $$;
grant execute on function pg_temp.expect_error(text,text) to service_role, authenticated;

set local role service_role;
do $$
declare
  a constant uuid := '22200000-0000-4000-8000-000000000001';
  b constant uuid := '22200000-0000-4000-8000-000000000002';
  da constant text := repeat('a',64); dx constant text := repeat('c',64); db constant text := repeat('b',64);
begin
  -- Direct intake (Hevy, iCloud): generation fencing, replay, identity binding.
  if public.connector_install_credential(a,'hevy',da,0,null,'sealed-hevy-a') <> 1 then raise exception 'hevy install failed'; end if;
  perform pg_temp.expect_error(format('select public.connector_install_credential(%L,%L,%L,0,null,%L)',a,'hevy',da,'replay'),'connector_connection_changed');
  perform pg_temp.expect_error(format('select public.connector_install_credential(%L,%L,%L,1,%L,%L)',a,'hevy',da,repeat('e',64),'x'),'connector_connection_changed');
  perform pg_temp.expect_error(format('select public.connector_install_credential(%L,%L,%L,1,null,%L)',a,'hevy',dx,'other'),'connector_wrong_account');
  perform pg_temp.expect_error(format('select public.connector_install_credential(%L,%L,%L,0,null,%L)',a,'google_calendar',da,'x'),'connector_provider_unsupported');
  perform pg_temp.expect_error(format('select public.connector_install_credential(%L,%L,%L,0,null,%L)',a,'hevy','not-a-digest','x'),'connector_invalid_identity');
  perform pg_temp.expect_error(format('select public.connector_install_credential(%L,%L,%L,0,null,%L)','22200000-0000-4000-8000-0000000000ff','hevy',da,'x'),'connector_owner_missing');
  if public.connector_install_credential(a,'icloud_calendar',da,0,null,'sealed-icloud-a') <> 1 then raise exception 'icloud install failed'; end if;
  if public.connector_install_credential(b,'hevy',db,0,null,'sealed-hevy-b') <> 1 then raise exception 'second owner install failed'; end if;

  -- Reads require owner, provider, identity, and generation together.
  if public.connector_read_credential(a,'hevy',da,1) <> 'sealed-hevy-a' then raise exception 'credential missing'; end if;
  if public.connector_read_credential(b,'hevy',da,1) is not null then raise exception 'cross-owner read'; end if;
  if public.connector_read_credential(a,'hevy',db,1) is not null then raise exception 'cross-identity read'; end if;
  if public.connector_read_credential(a,'outlook_calendar',da,1) is not null then raise exception 'cross-provider read'; end if;
  if public.connector_read_credential(a,'hevy',da,0) is not null then raise exception 'stale generation read'; end if;

  -- Outlook OAuth attempt: one use, state-bound, generation-fenced.
  perform pg_temp.expect_error(format('select public.connector_begin_attempt(%L,%L,%L,%L,0,%L,%L)',a,'hevy',repeat('1',64),'v','web',''),'connector_provider_unsupported');
  perform pg_temp.expect_error(format('select public.connector_begin_attempt(%L,%L,%L,%L,0,%L,%L)',a,'outlook_calendar',repeat('1',64),'v','desktop','short'),'connector_invalid_state');
  if public.connector_begin_attempt(a,'outlook_calendar',repeat('1',64),'sealed-verifier',0,'web','') <> 0 then raise exception 'begin failed'; end if;
  perform pg_temp.expect_error(format('select public.connector_begin_attempt(%L,%L,%L,%L,5,%L,%L)',a,'outlook_calendar',repeat('2',64),'v','web',''),'connector_connection_changed');
  if public.connector_consume_attempt('hevy',repeat('1',64)) is not null then raise exception 'cross-provider consume'; end if;
  if public.connector_consume_attempt('outlook_calendar',repeat('1',64)) is null then raise exception 'consume failed'; end if;
  if public.connector_consume_attempt('outlook_calendar',repeat('1',64)) is not null then raise exception 'attempt replay allowed'; end if;
  perform pg_temp.expect_error(format('select public.connector_install_credential(%L,%L,%L,0,%L,%L)',a,'outlook_calendar',da,repeat('9',64),'x'),'connector_connection_changed');
  perform pg_temp.expect_error(format('select public.connector_install_credential(%L,%L,%L,0,null,%L)',a,'outlook_calendar',da,'x'),'connector_connection_changed');
  if public.connector_install_credential(a,'outlook_calendar',da,0,repeat('1',64),'sealed-outlook-a') <> 1 then raise exception 'outlook install failed'; end if;
  perform pg_temp.expect_error(format('select public.connector_install_credential(%L,%L,%L,0,%L,%L)',a,'outlook_calendar',da,repeat('1',64),'late'),'connector_connection_changed');

  -- Refresh rotation stays inside the current generation.
  if not public.connector_replace_credential(a,'outlook_calendar',da,1,'rotated-outlook-a') then raise exception 'rotation failed'; end if;
  if public.connector_replace_credential(a,'outlook_calendar',da,0,'stale') then raise exception 'stale rotation accepted'; end if;
  if public.connector_replace_credential(b,'outlook_calendar',da,1,'other-owner') then raise exception 'cross-owner rotation'; end if;
  if public.connector_read_credential(a,'outlook_calendar',da,1) <> 'rotated-outlook-a' then raise exception 'rotation lost'; end if;

  -- Disconnect fences one provider only and releases its identity binding.
  if public.connector_disconnect(a,'hevy',1,'disconnected') <> 2 then raise exception 'disconnect failed'; end if;
  perform pg_temp.expect_error(format('select public.connector_disconnect(%L,%L,1,%L)',a,'hevy','disconnected'),'connector_connection_changed');
  if public.connector_read_credential(a,'hevy',da,1) is not null then raise exception 'credential retained'; end if;
  if public.connector_replace_credential(a,'hevy',da,1,'resurrect') then raise exception 'late refresh resurrected'; end if;
  perform pg_temp.expect_error(format('select public.connector_install_credential(%L,%L,%L,1,null,%L)',a,'hevy',da,'late'),'connector_connection_changed');
  perform pg_temp.expect_error('select count(*) from cadence_calendar_private.connector_credentials','42501');
  if public.connector_read_credential(a,'icloud_calendar',da,1) <> 'sealed-icloud-a' then raise exception 'disconnect crossed providers'; end if;
  if public.connector_read_credential(a,'outlook_calendar',da,1) <> 'rotated-outlook-a' then raise exception 'disconnect crossed providers'; end if;
  if public.connector_read_credential(b,'hevy',db,1) <> 'sealed-hevy-b' then raise exception 'disconnect crossed owners'; end if;
  if public.connector_install_credential(a,'hevy',dx,2,null,'sealed-hevy-new') <> 3 then raise exception 'reconnect after disconnect failed'; end if;

  -- reconnect_required keeps the identity, so only the same account can return.
  perform pg_temp.expect_error(format('select public.connector_disconnect(%L,%L,1,%L)',a,'icloud_calendar','connected'),'connector_invalid_status');
  if public.connector_disconnect(a,'icloud_calendar',1,'reconnect_required') <> 2 then raise exception 'reconnect_required failed'; end if;
  perform pg_temp.expect_error(format('select public.connector_disconnect(%L,%L,2,%L)',a,'icloud_calendar','reconnect_required'),'connector_connection_changed');
  perform pg_temp.expect_error(format('select public.connector_install_credential(%L,%L,%L,2,null,%L)',a,'icloud_calendar',dx,'x'),'connector_wrong_account');
  if public.connector_install_credential(a,'icloud_calendar',da,2,null,'sealed-icloud-a2') <> 3 then raise exception 'same account reconnect failed'; end if;

  -- An attempt started before disconnect cannot complete after it.
  perform public.connector_begin_attempt(a,'outlook_calendar',repeat('3',64),'sealed-verifier',1,'web','');
  perform public.connector_disconnect(a,'outlook_calendar',1,'disconnected');
  if public.connector_consume_attempt('outlook_calendar',repeat('3',64)) is not null then raise exception 'attempt survived disconnect'; end if;
  perform pg_temp.expect_error(format('select public.connector_install_credential(%L,%L,%L,1,%L,%L)',a,'outlook_calendar',da,repeat('3',64),'late'),'connector_connection_changed');
end $$;

-- Direct client access: owner metadata through RLS only; no credentials or RPCs.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.connector_connections) <> 3 then raise exception 'connection isolation'; end if;
  if exists (select 1 from public.connector_connections where user_id <> '22200000-0000-4000-8000-000000000001') then raise exception 'cross-account connection'; end if;
  if (select count(*) from public.connector_preferences) <> 3 then raise exception 'preferences isolation'; end if;
  perform pg_temp.expect_error('select attempt_hash from public.connector_connections','42501');
  perform pg_temp.expect_error('select * from cadence_calendar_private.connector_credentials','42501');
  perform pg_temp.expect_error('select * from cadence_calendar_private.connector_attempts','42501');
  perform pg_temp.expect_error($q$select public.connector_read_credential('22200000-0000-4000-8000-000000000001','hevy',repeat('c',64),3)$q$,'42501');
  perform pg_temp.expect_error($q$select public.connector_disconnect('22200000-0000-4000-8000-000000000002','hevy',1,'disconnected')$q$,'42501');
  perform pg_temp.expect_error($q$update public.connector_connections set status='connected'$q$,'42501');
  perform pg_temp.expect_error($q$insert into public.connector_connections(user_id,provider) values('22200000-0000-4000-8000-000000000001','hevy')$q$,'42501');
  perform pg_temp.expect_error($q$delete from public.connector_preferences$q$,'42501');
  perform pg_temp.expect_error($q$update public.connector_preferences set provider='hevy'$q$,'42501');
  perform pg_temp.expect_error($q$update public.connector_preferences set selection_revision=0$q$,'42501');
  if has_schema_privilege('authenticated','cadence_calendar_private','USAGE') then raise exception 'private schema exposed'; end if;
  if has_function_privilege('authenticated','public.connector_install_credential(uuid,text,text,bigint,text,text)','EXECUTE')
    or has_function_privilege('anon','public.connector_consume_attempt(text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.connector_begin_attempt(uuid,text,text,text,bigint,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.connector_replace_credential(uuid,text,text,bigint,text)','EXECUTE')
    or has_function_privilege('anon','public.connector_read_credential(uuid,text,text,bigint)','EXECUTE')
    or has_function_privilege('anon','public.connector_disconnect(uuid,text,bigint,text)','EXECUTE') then raise exception 'credential RPC exposed'; end if;
  if has_table_privilege('anon','public.connector_connections','SELECT') or has_table_privilege('anon','public.connector_preferences','SELECT') then raise exception 'anon metadata exposed'; end if;
  update public.connector_preferences set visible=false where user_id='22200000-0000-4000-8000-000000000002';
  if found then raise exception 'cross account update'; end if;
  update public.connector_preferences set selected_source_ids=array['synthetic-calendar']
    where user_id='22200000-0000-4000-8000-000000000001' and provider='icloud_calendar';
  if not found then raise exception 'owner preference update failed'; end if;
  if (select selection_revision from public.connector_preferences where provider='icloud_calendar') < 1 then raise exception 'selection revision failed'; end if;
  perform pg_temp.expect_error($q$update public.connector_preferences set selected_source_ids=array['x'] where provider='hevy'$q$,'23514');
  perform pg_temp.expect_error($q$update public.connector_preferences set hidden_source_ids=array['missing'] where provider='icloud_calendar'$q$,'23514');
end $$;

-- Account deletion: a failed deletion preserves every connection; a successful
-- deletion removes this owner's connector state only.
reset role;
insert into public.google_calendar_connections(user_id,google_subject,generation,status)
values('22200000-0000-4000-8000-000000000002','connector-two-google',1,'connected');
insert into cadence_calendar_private.credentials values('22200000-0000-4000-8000-000000000002','connector-two-google',1,'sealed-google-b');
do $$
declare a constant uuid := '22200000-0000-4000-8000-000000000001';
begin
  perform public.connector_begin_attempt(a,'outlook_calendar',repeat('4',64),'sealed-verifier',2,'web','');
  begin
    delete from auth.users where id = a;
    raise exception 'synthetic_auth_failure';
  exception when others then
    if sqlerrm <> 'synthetic_auth_failure' then raise; end if;
  end;
  if (select count(*) from public.connector_connections where user_id=a) <> 3
    or (select count(*) from cadence_calendar_private.connector_credentials where user_id=a) <> 2
    or (select count(*) from cadence_calendar_private.connector_attempts where user_id=a) <> 1 then
    raise exception 'failed deletion did not preserve connections';
  end if;
  delete from auth.users where id = a;
  if exists (select 1 from public.connector_connections where user_id=a) or exists (select 1 from public.connector_preferences where user_id=a)
    or exists (select 1 from cadence_calendar_private.connector_credentials where user_id=a)
    or exists (select 1 from cadence_calendar_private.connector_attempts where user_id=a) then
    raise exception 'deletion retained connector state';
  end if;
  if (select count(*) from public.connector_connections where user_id='22200000-0000-4000-8000-000000000002') <> 1
    or (select sealed_credential from cadence_calendar_private.connector_credentials where user_id='22200000-0000-4000-8000-000000000002') <> 'sealed-hevy-b'
    or (select sealed_token from cadence_calendar_private.credentials where user_id='22200000-0000-4000-8000-000000000002') <> 'sealed-google-b' then
    raise exception 'deletion affected another owner or Google';
  end if;
end $$;
rollback;

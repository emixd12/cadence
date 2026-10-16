\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('18700000-0000-4000-8000-000000000001','authenticated','authenticated','agent-one@example.invalid','{}','{}'),
('18700000-0000-4000-8000-000000000002','authenticated','authenticated','agent-two@example.invalid','{}','{}');
insert into auth.identities(provider_id,user_id,identity_data,provider)
values('agent-one','18700000-0000-4000-8000-000000000001','{"sub":"agent-one"}','google'),
('agent-two','18700000-0000-4000-8000-000000000002','{"sub":"agent-two"}','google');
insert into auth.sessions(id,user_id)
values('18700000-0000-4000-8000-000000000003','18700000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"18700000-0000-4000-8000-000000000001","role":"authenticated","session_id":"18700000-0000-4000-8000-000000000003"}',true);
set local role service_role;
select public.calendar_begin_attempt('18700000-0000-4000-8000-000000000001','agent-one',repeat('a',64),'standard-verifier',0,'web','');
select public.calendar_agent_begin_attempt('18700000-0000-4000-8000-000000000001','agent-one',repeat('b',64),'agent-verifier',0,'web','','agent-client');
select public.calendar_agent_begin_attempt('18700000-0000-4000-8000-000000000002','agent-two',repeat('c',64),'agent-verifier',0,'web','','agent-client');
do $$ begin
 if public.calendar_consume_attempt(repeat('b',64)) is not null then raise exception 'agent attempt crossed to standard'; end if;
 if public.calendar_agent_consume_attempt(repeat('a',64)) is not null then raise exception 'standard attempt crossed to agent'; end if;
 if public.calendar_agent_consume_attempt(repeat('b',64))->>'oauth_client_id' <> 'agent-client' then raise exception 'agent client binding missing'; end if;
 if public.calendar_agent_consume_attempt(repeat('b',64)) is not null then raise exception 'agent replay accepted'; end if;
 if not public.calendar_install_credential('18700000-0000-4000-8000-000000000001','agent-one',0,repeat('a',64),'standard-token') then raise exception 'standard changed'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin
  perform public.save_daily_brief_preferences_v2(true,true,false,false,0);
  raise exception 'standard grant authorized agent disclosure';
 exception when sqlstate '55000' then null;
 end;
end $$;
set local role service_role;
do $$ begin
 if public.calendar_agent_install_credential('18700000-0000-4000-8000-000000000001','agent-two',0,repeat('b',64),'agent-token','agent-client') then raise exception 'wrong identity accepted'; end if;
 if not public.calendar_agent_install_credential('18700000-0000-4000-8000-000000000001','agent-one',0,repeat('b',64),'agent-token','agent-client') then raise exception 'agent install failed'; end if;
 if public.calendar_agent_read_credential('18700000-0000-4000-8000-000000000001','agent-one',1) <> 'agent-token' then raise exception 'agent token missing'; end if;
end $$;
set local role authenticated;
select public.save_daily_brief_preferences_v2(true,true,false,false,0);
reset role;
do $$ begin
 if not cadence_advisor_private.daily_brief_calendar_fence_is_current('18700000-0000-4000-8000-000000000001',true,1,0) then raise exception 'agent fence rejected'; end if;
end $$;
set local role service_role;
do $$ begin
 perform public.calendar_agent_disconnect('18700000-0000-4000-8000-000000000001','agent-one',1,'disconnected');
 if public.calendar_agent_read_credential('18700000-0000-4000-8000-000000000001','agent-one',1) is not null then raise exception 'agent token survived disconnect'; end if;
 if public.calendar_read_credential('18700000-0000-4000-8000-000000000001','agent-one',1) <> 'standard-token' then raise exception 'agent disconnect changed standard'; end if;
 if public.calendar_agent_install_credential('18700000-0000-4000-8000-000000000001','agent-one',0,repeat('b',64),'late','agent-client') then raise exception 'late agent callback resurrected'; end if;
end $$;
reset role;
do $$ begin
 if cadence_advisor_private.daily_brief_calendar_fence_is_current('18700000-0000-4000-8000-000000000001',true,1,0) then raise exception 'disconnected agent fence accepted standard grant'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"18700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin
 if (select count(*) from public.google_calendar_agent_connections) <> 1 then raise exception 'agent connection isolation'; end if;
 if (select count(*) from public.google_calendar_agent_preferences) <> 1 then raise exception 'agent selection isolation'; end if;
 if has_function_privilege('authenticated','public.calendar_agent_read_credential(uuid,text,bigint)','EXECUTE') then raise exception 'agent credential RPC exposed'; end if;
 if has_function_privilege('anon','public.calendar_agent_consume_attempt(text)','EXECUTE') then raise exception 'agent attempt RPC exposed'; end if;
 if has_schema_privilege('authenticated','cadence_calendar_agent_private','USAGE') then raise exception 'agent private schema exposed'; end if;
 if has_table_privilege('authenticated','public.google_calendar_agent_connections','UPDATE') then raise exception 'agent connection writable'; end if;
 update public.google_calendar_agent_preferences set selected_calendar_ids=array['work'] where user_id='18700000-0000-4000-8000-000000000002';
 if found then raise exception 'cross account selection'; end if;
end $$;
reset role;
rollback;

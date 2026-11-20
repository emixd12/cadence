-- Advisor plan Phase 5 (5A): chat storage.
--
-- Server-only tables (never in the account sync projection or exports for now).
-- Conversations are kept until the person deletes their data (D7): every row
-- cascades with the Auth user, which is what Settings > Delete account removes.
-- Chat text lives only here (T15); it is not added to the 30-day content store.
--
-- Only the chat agent token (cadence_channel 'chat', no MCP grant) reads or
-- writes these rows, and only its own person's rows. The person's session, MCP
-- tokens, job channels and the other agents are refused by the policies.
begin;

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  -- Written by code, not a model: earlier questions and outcomes beyond the history cap (T21).
  summary text check (summary is null or length(summary) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chat_conversations_user_recent_idx on public.chat_conversations (user_id, updated_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- ChatPart[] (packages/core/src/types/chat.ts).
  parts jsonb not null check (jsonb_typeof(parts) = 'array' and octet_length(parts::text) <= 262144),
  -- User messages: the client's id for this send, so a retry never runs the turn twice.
  client_message_id uuid,
  -- Assistant messages: the question they answer.
  reply_to uuid references public.chat_messages(id) on delete cascade,
  -- Assistant messages are 'streaming' until the turn finishes.
  state text not null default 'complete' check (state in ('streaming', 'complete')),
  agent_run_id uuid,
  -- Assistant messages: set when the person pressed Stop; the running turn polls it.
  stop_requested_at timestamptz,
  created_at timestamptz not null default now(),
  check ((role = 'user') = (client_message_id is not null)),
  check (stop_requested_at is null or role = 'assistant'),
  check ((role = 'assistant') = (reply_to is not null))
);
create index chat_messages_conversation_idx on public.chat_messages (conversation_id, created_at, id);
create unique index chat_messages_client_id_idx on public.chat_messages (user_id, client_message_id) where client_message_id is not null;
create unique index chat_messages_reply_idx on public.chat_messages (reply_to) where reply_to is not null;

-- One row per write chat made: its kind, whether it was confirmed, and whether it
-- was undone (5A step 5). undo_plan holds the call that undoes it, including the old
-- note text for note edits (T11), kept with the conversation.
create table public.chat_actions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  operation text not null check (operation ~ '^[a-z][a-z_]{2,63}$'),
  kind text not null check (kind in (
    'status', 'occurrence_note', 'day_note', 'move', 'create_behavior', 'update_behavior', 'archive_behavior', 'restore_behavior'
  )),
  confirmed boolean not null,
  outcome jsonb not null check (octet_length(outcome::text) <= 8192),
  undo_plan jsonb check (undo_plan is null or octet_length(undo_plan::text) <= 32768),
  undo_state text not null check (undo_state in ('available', 'undoing', 'done', 'unavailable')),
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  check ((undo_state = 'done') = (undone_at is not null))
);
create index chat_actions_message_idx on public.chat_actions (message_id);
create index chat_actions_user_recent_idx on public.chat_actions (user_id, created_at desc);

-- A Yes · No question listing every pending write of one question (T12, T13).
-- Expires after 15 minutes, on a newer message in the conversation, or when a
-- listed record changed (checked by the server at Yes time).
create table public.chat_confirms (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  writes jsonb not null check (jsonb_typeof(writes) = 'array' and octet_length(writes::text) <= 65536),
  confirm jsonb not null check (octet_length(confirm::text) <= 16384),
  state text not null default 'pending' check (state in ('pending', 'answering', 'accepted', 'declined', 'expired')),
  expires_at timestamptz not null,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '1 hour')
);
create index chat_confirms_conversation_pending_idx on public.chat_confirms (conversation_id) where state = 'pending';
create index chat_confirms_message_idx on public.chat_confirms (message_id);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_actions enable row level security;
alter table public.chat_confirms enable row level security;

revoke all on table public.chat_conversations, public.chat_messages, public.chat_actions, public.chat_confirms
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.chat_conversations, public.chat_messages, public.chat_actions, public.chat_confirms
  to authenticated;

-- The chat agent acting as its own person; nothing else.
create policy chat_conversations_chat_agent on public.chat_conversations
  for all to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt() ->> 'cadence_channel') = 'chat' and (select auth.jwt() ->> 'cadence_grant_id') is null)
  with check (user_id = (select auth.uid()) and (select auth.jwt() ->> 'cadence_channel') = 'chat' and (select auth.jwt() ->> 'cadence_grant_id') is null);
create policy chat_messages_chat_agent on public.chat_messages
  for all to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt() ->> 'cadence_channel') = 'chat' and (select auth.jwt() ->> 'cadence_grant_id') is null)
  with check (user_id = (select auth.uid()) and (select auth.jwt() ->> 'cadence_channel') = 'chat' and (select auth.jwt() ->> 'cadence_grant_id') is null);
create policy chat_actions_chat_agent on public.chat_actions
  for all to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt() ->> 'cadence_channel') = 'chat' and (select auth.jwt() ->> 'cadence_grant_id') is null)
  with check (user_id = (select auth.uid()) and (select auth.jwt() ->> 'cadence_channel') = 'chat' and (select auth.jwt() ->> 'cadence_grant_id') is null);
create policy chat_confirms_chat_agent on public.chat_confirms
  for all to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt() ->> 'cadence_channel') = 'chat' and (select auth.jwt() ->> 'cadence_grant_id') is null)
  with check (user_id = (select auth.uid()) and (select auth.jwt() ->> 'cadence_channel') = 'chat' and (select auth.jwt() ->> 'cadence_grant_id') is null);

commit;

-- Note shortcuts revamp (Step 1): lower minimum evidence for proposed shortcuts
-- from 3 to 2 distinct Occurrences / day notes (owner decision, 2026-11-24).
-- Strictly more permissive than 3; all existing note_shortcut_states rows remain valid.
begin;

create or replace function cadence_private.note_shortcut_entries_valid(entries jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  entry jsonb;
  evidence jsonb;
  entry_keys text[] := '{}';
  evidence_ids text[];
  entry_key text;
  shortcut_text text;
  normalized_text text;
  accepted_texts text[] := '{}';
  accepted_count integer := 0;
  proposed_count integer := 0;
begin
  if entries is null or jsonb_typeof(entries) <> 'array'
    or jsonb_array_length(entries) > 128
  then
    return false;
  end if;

  for entry in select value from jsonb_array_elements(entries) loop
    if jsonb_typeof(entry) <> 'object'
      or not (entry ?& array['key', 'text', 'status', 'source', 'evidence', 'created_at', 'expires_at'])
      or (entry - array['key', 'text', 'status', 'source', 'evidence', 'created_at', 'expires_at']) <> '{}'::jsonb
      or jsonb_typeof(entry -> 'key') <> 'string'
      or coalesce(entry ->> 'key', '') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(entry -> 'status') <> 'string'
      or entry ->> 'status' not in ('proposed', 'accepted', 'dismissed')
      or jsonb_typeof(entry -> 'source') <> 'string'
      or entry ->> 'source' not in ('repeated_text', 'model')
      or jsonb_typeof(entry -> 'evidence') <> 'array'
      or jsonb_array_length(entry -> 'evidence') > 100
      or jsonb_typeof(entry -> 'created_at') <> 'string'
      or jsonb_typeof(entry -> 'expires_at') not in ('string', 'null')
    then
      return false;
    end if;

    entry_key := entry ->> 'key';
    if entry_key = any(entry_keys) then return false; end if;
    entry_keys := array_append(entry_keys, entry_key);
    perform (entry ->> 'created_at')::timestamptz;
    if jsonb_typeof(entry -> 'expires_at') = 'string' then
      perform (entry ->> 'expires_at')::timestamptz;
    end if;

    evidence_ids := '{}';
    for evidence in select value from jsonb_array_elements(entry -> 'evidence') loop
      if jsonb_typeof(evidence) <> 'object'
        or not (evidence ?& array['occurrence_id', 'note_hash'])
        or (evidence - array['occurrence_id', 'note_hash']) <> '{}'::jsonb
        or jsonb_typeof(evidence -> 'occurrence_id') <> 'string'
        or jsonb_typeof(evidence -> 'note_hash') <> 'string'
        or coalesce(evidence ->> 'occurrence_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(evidence ->> 'note_hash', '') !~ '^[a-f0-9]{64}$'
        or evidence ->> 'occurrence_id' = any(evidence_ids)
      then
        return false;
      end if;
      evidence_ids := array_append(evidence_ids, evidence ->> 'occurrence_id');
    end loop;

    if entry ->> 'status' = 'dismissed' then
      if jsonb_typeof(entry -> 'text') <> 'null'
        or jsonb_array_length(entry -> 'evidence') <> 0
        or jsonb_typeof(entry -> 'expires_at') <> 'string'
      then
        return false;
      end if;
    else
      if jsonb_typeof(entry -> 'text') <> 'string' then return false; end if;
      shortcut_text := entry ->> 'text';
      normalized_text := normalize(
        regexp_replace(
          regexp_replace(shortcut_text, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
          '[[:space:]]+', ' ', 'g'
        ),
        NFKC
      );
      if char_length(shortcut_text) not between 1 and 160
        or shortcut_text <> normalized_text
        or shortcut_text ~ '[[:cntrl:]]'
        or shortcut_text ~ U&'[\200B\200C\200D\2060\FEFF]'
        or lower(shortcut_text) ~ '(ignore.*(previous|instructions?)|(system|assistant|developer)[[:space:]]*:|system prompt|developer message|output a completed status)'
      then
        return false;
      end if;
    end if;

    if entry ->> 'status' = 'accepted' then
      accepted_count := accepted_count + 1;
      if lower(shortcut_text) = any(accepted_texts) then return false; end if;
      accepted_texts := array_append(accepted_texts, lower(shortcut_text));
      if jsonb_array_length(entry -> 'evidence') <> 0
        or jsonb_typeof(entry -> 'expires_at') <> 'null'
      then
        return false;
      end if;
    elsif entry ->> 'status' = 'proposed' then
      proposed_count := proposed_count + 1;
      if jsonb_array_length(entry -> 'evidence') < 2
        or jsonb_typeof(entry -> 'expires_at') <> 'string'
      then
        return false;
      end if;
    end if;
  end loop;

  -- Reserve capacity for removal of edited accepted text and its original pattern.
  return accepted_count <= 20 and proposed_count <= 5
    and jsonb_array_length(entries) + accepted_count <= 128;
exception when others then
  return false;
end;
$$;

commit;

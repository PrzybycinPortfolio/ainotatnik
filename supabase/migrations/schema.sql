-- Enable pgvector extension for semantic search
create extension if not exists vector;

-- ── Notes ────────────────────────────────────────────────────────────────────

create table if not exists notes (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users(id) on delete cascade not null,
  title       text        not null,
  content     text        not null,
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null
);

-- ── Conversations ─────────────────────────────────────────────────────────────

create table if not exists conversations (
  id         uuid        default gen_random_uuid() primary key,
  user_id    uuid        references auth.users(id) on delete cascade not null,
  created_at timestamptz default now() not null
);

-- ── Messages ──────────────────────────────────────────────────────────────────

create table if not exists messages (
  id              uuid        default gen_random_uuid() primary key,
  conversation_id uuid        references conversations(id) on delete cascade not null,
  role            text        check (role in ('user', 'model')) not null,
  content         text        not null,
  created_at      timestamptz default now() not null
);

-- ── Embeddings ────────────────────────────────────────────────────────────────
-- text-embedding-004 (Gemini) produces 768-dimensional vectors

create table if not exists embeddings (
  id         uuid        default gen_random_uuid() primary key,
  note_id    uuid        references notes(id) on delete cascade not null unique,
  embedding  vector(768) not null,
  created_at timestamptz default now() not null
);

-- Index for fast similarity search
create index if not exists embeddings_embedding_idx
  on embeddings using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ── Auto-update updated_at ────────────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger notes_updated_at
  before update on notes
  for each row execute function update_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────

alter table notes         enable row level security;
alter table conversations enable row level security;
alter table messages      enable row level security;
alter table embeddings    enable row level security;

-- Notes policies
create policy "notes: select own"  on notes for select using (auth.uid() = user_id);
create policy "notes: insert own"  on notes for insert with check (auth.uid() = user_id);
create policy "notes: update own"  on notes for update using (auth.uid() = user_id);
create policy "notes: delete own"  on notes for delete using (auth.uid() = user_id);

-- Conversations policies
create policy "conversations: select own" on conversations for select using (auth.uid() = user_id);
create policy "conversations: insert own" on conversations for insert with check (auth.uid() = user_id);

-- Messages policies (access through conversation ownership)
create policy "messages: select own" on messages for select
  using (exists (
    select 1 from conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  ));

create policy "messages: insert own" on messages for insert
  with check (exists (
    select 1 from conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  ));

-- Embeddings policies (access through note ownership)
create policy "embeddings: select own" on embeddings for select
  using (exists (
    select 1 from notes n where n.id = note_id and n.user_id = auth.uid()
  ));

create policy "embeddings: insert own" on embeddings for insert
  with check (exists (
    select 1 from notes n where n.id = note_id and n.user_id = auth.uid()
  ));

create policy "embeddings: update own" on embeddings for update
  using (exists (
    select 1 from notes n where n.id = note_id and n.user_id = auth.uid()
  ));

-- ── Semantic search function ──────────────────────────────────────────────────

create or replace function search_notes_by_embedding(
  query_embedding vector(768),
  match_threshold float   default 0.7,
  match_count     int     default 10,
  p_user_id       uuid    default null
)
returns table (
  id         uuid,
  user_id    uuid,
  title      text,
  content    text,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    n.id,
    n.user_id,
    n.title,
    n.content,
    n.created_at,
    n.updated_at,
    1 - (e.embedding <=> query_embedding) as similarity
  from notes n
  join embeddings e on e.note_id = n.id
  where
    (p_user_id is null or n.user_id = p_user_id)
    and 1 - (e.embedding <=> query_embedding) > match_threshold
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

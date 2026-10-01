-- ── Files (uploaded source documents: invoices, future doc types) ────────────

create table if not exists files (
  id            uuid        default gen_random_uuid() primary key,
  user_id       uuid        references auth.users(id) on delete cascade not null,
  filename      text        not null,
  mime_type     text        not null,
  storage_path  text        not null,
  status        text        check (status in ('pending', 'processing', 'done', 'error')) default 'pending' not null,
  error_message text,
  created_at    timestamptz default now() not null
);

alter table files enable row level security;

create policy "files: select own" on files for select using (auth.uid() = user_id);
create policy "files: insert own" on files for insert with check (auth.uid() = user_id);
create policy "files: update own" on files for update using (auth.uid() = user_id);
create policy "files: delete own" on files for delete using (auth.uid() = user_id);

-- ── User profile (context used to classify invoices as business vs personal) ─

create table if not exists user_profiles (
  user_id               uuid        references auth.users(id) on delete cascade primary key,
  business_description  text,
  updated_at            timestamptz default now() not null
);

alter table user_profiles enable row level security;

create policy "user_profiles: select own" on user_profiles for select using (auth.uid() = user_id);
create policy "user_profiles: insert own" on user_profiles for insert with check (auth.uid() = user_id);
create policy "user_profiles: update own" on user_profiles for update using (auth.uid() = user_id);

-- ── Invoices (use case 1: koszt uzyskania przychodu) ──────────────────────────
-- NOTE: this computes a deterministic sum of net_amount for invoices classified
-- as business-related and not excluded. It is a bookkeeping aid, not tax advice —
-- KUP eligibility has category-specific exceptions (representation costs, partial
-- vehicle deductions, etc.) that are NOT modeled here and must be reviewed by an
-- accountant before filing.

create table if not exists invoices (
  id                     uuid          default gen_random_uuid() primary key,
  user_id                uuid          references auth.users(id) on delete cascade not null,
  file_id                uuid          references files(id) on delete set null,
  invoice_number         text,
  vendor_name            text,
  issue_date             date,
  net_amount             numeric(12,2),
  vat_amount             numeric(12,2),
  gross_amount           numeric(12,2),
  category               text,
  is_business            boolean,
  classification_reason  text,
  excluded               boolean       default false not null,
  excluded_reason        text,
  raw_extraction         jsonb,
  created_at             timestamptz   default now() not null
);

create index if not exists invoices_user_issue_date_idx on invoices (user_id, issue_date);

alter table invoices enable row level security;

create policy "invoices: select own" on invoices for select using (auth.uid() = user_id);
create policy "invoices: insert own" on invoices for insert with check (auth.uid() = user_id);
create policy "invoices: update own" on invoices for update using (auth.uid() = user_id);
create policy "invoices: delete own" on invoices for delete using (auth.uid() = user_id);

-- ── Legal acts (use case 2: shared reference data, not per-user) ─────────────
-- Uploaded once by the app owner via scripts/ingestLegalAct.ts (service role,
-- bypasses RLS). Regular users get read-only access — there is deliberately no
-- insert/update/delete policy for the `authenticated` role.

create table if not exists legal_acts (
  id                 uuid        default gen_random_uuid() primary key,
  act_name           text        not null,
  legal_status_date  date        not null,
  uploaded_by        uuid        references auth.users(id),
  created_at         timestamptz default now() not null
);

create table if not exists legal_chunks (
  id              uuid        default gen_random_uuid() primary key,
  legal_act_id    uuid        references legal_acts(id) on delete cascade not null,
  article_number  text,
  content         text        not null,
  embedding       vector(768) not null,
  created_at      timestamptz default now() not null
);

create index if not exists legal_chunks_embedding_idx
  on legal_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table legal_acts   enable row level security;
alter table legal_chunks enable row level security;

create policy "legal_acts: read all authenticated"   on legal_acts   for select using (auth.role() = 'authenticated');
create policy "legal_chunks: read all authenticated" on legal_chunks for select using (auth.role() = 'authenticated');

create or replace function search_legal_chunks_by_embedding(
  query_embedding extensions.vector(768),
  match_threshold float default 0.65,
  match_count     int   default 8
)
returns table (
  legal_chunk_id     uuid,
  act_name           text,
  article_number     text,
  content            text,
  legal_status_date  date,
  similarity         float
)
language sql stable
set search_path = public, extensions
as $$
  select
    lc.id,
    la.act_name,
    lc.article_number,
    lc.content,
    la.legal_status_date,
    1 - (lc.embedding <=> query_embedding) as similarity
  from legal_chunks lc
  join legal_acts la on la.id = lc.legal_act_id
  where 1 - (lc.embedding <=> query_embedding) > match_threshold
  order by lc.embedding <=> query_embedding
  limit match_count;
$$;

-- ── API keys (service-to-service auth for external/CRM integrations) ─────────
-- Only the SHA-256 hash is stored, never the raw key — it is shown once at
-- creation time, like a GitHub personal access token. A key acts on behalf of
-- its owner_user_id: external calls are scoped by that user's RLS, same as a
-- browser session, just authenticated differently.

create table if not exists api_keys (
  id             uuid        default gen_random_uuid() primary key,
  owner_user_id  uuid        references auth.users(id) on delete cascade not null,
  name           text        not null,
  key_hash       text        not null unique,
  created_at     timestamptz default now() not null,
  last_used_at   timestamptz,
  revoked_at     timestamptz
);

alter table api_keys enable row level security;

create policy "api_keys: select own" on api_keys for select using (auth.uid() = owner_user_id);
create policy "api_keys: insert own" on api_keys for insert with check (auth.uid() = owner_user_id);
create policy "api_keys: update own" on api_keys for update using (auth.uid() = owner_user_id);

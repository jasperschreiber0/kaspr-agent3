-- Backfills schema for kaspr-agent3 ("Publisher") that has existed in
-- production but was never checked into version control. Idempotent.

-- ─── Scheduled posts ─────────────────────────────────────────────────────
-- Written by: agent3 (src/supabase.js createScheduledPost/updateScheduledPost)
-- Read by:    agent3 itself (getScheduledPostsForClient, getPendingScheduledPosts)

create table if not exists scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  queue_id uuid references content_queue(id) on delete set null,
  trend_brief_id uuid references trend_briefs(id) on delete set null,
  instagram_caption text,
  tiktok_caption text,
  instagram_hashtags text[] not null default array[]::text[],
  tiktok_hashtags text[] not null default array[]::text[],
  scheduled_at timestamptz not null,
  status text not null default 'scheduled', -- 'scheduled' | 'posted' | 'failed'
  posted_at timestamptz,
  instagram_post_id text,
  tiktok_post_id text,
  created_at timestamptz not null default now()
);

create index if not exists scheduled_posts_client_id_idx on scheduled_posts(client_id);
-- Matches getPendingScheduledPosts(): status='scheduled' AND scheduled_at <= now()
create index if not exists scheduled_posts_status_scheduled_at_idx
  on scheduled_posts(status, scheduled_at);
-- Matches getScheduledPostsForClient(): client_id + status='scheduled' + scheduled_at >= now()
create index if not exists scheduled_posts_client_status_idx
  on scheduled_posts(client_id, status, scheduled_at);

-- ─── Missing `clients` columns referenced throughout agent3 ───────────────
alter table clients
  add column if not exists tiktok_access_token text,
  add column if not exists tiktok_refresh_token text,
  add column if not exists tiktok_token_expires_at timestamptz,
  add column if not exists tiktok_account_id text,
  add column if not exists blackout_dates date[] not null default array[]::date[];

create index if not exists clients_tiktok_account_id_idx on clients(tiktok_account_id)
  where tiktok_account_id is not null;

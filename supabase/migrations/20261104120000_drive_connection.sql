-- The club's Google Drive.
--
-- One Google account — the one with the storage — is connected from the
-- studio, and course videos and library files can live in it. This table holds
-- that connection: who it is, which folder the app writes into, and the
-- refresh token that lets the API act for it.
--
-- One row, enforced. There is exactly one club Drive; a second row would be a
-- question ("which one?") that nothing in the code is prepared to answer.
--
-- The refresh token is stored encrypted (AES-GCM, key in the Worker secret
-- DRIVE_SECRET), so a leaked database dump is not a leaked Drive. And the table
-- is unreachable through the Data API: RLS on, no policies, grants revoked.
-- Only the API's own database connection reads it. Admins see the connection
-- through the API, which never returns the token.

begin;

create table if not exists public.drive_connection (
  id text primary key default 'club' check (id = 'club'),
  account_email text not null,
  refresh_token_enc text not null,
  -- The folder uploads go into. Created by the app on connect, which matters:
  -- with the `drive.file` scope the app can only see folders it made itself.
  folder_id text,
  connected_by uuid references public.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.drive_connection enable row level security;
revoke all on table public.drive_connection from public, anon, authenticated;

commit;

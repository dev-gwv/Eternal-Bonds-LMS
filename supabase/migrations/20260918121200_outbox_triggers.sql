-- The database emits its own events.
--
-- Until now the API inserted outbox rows itself, inside the transaction that
-- adopts the caller's identity. That could never have worked: `outbox` has RLS
-- enabled and deliberately no policy, because it is service-role-only. Every
-- write that emitted an event — creating a post, liking one, scheduling an
-- account deletion — was one `insert` away from failing under RLS.
--
-- The fix is not an insert policy. Supabase exposes every table with a policy
-- through PostgREST, so `outbox_insert on authenticated` would let any member
-- POST a forged `course.published` and fan a notification out to the whole
-- club. Instead the *database* emits the event, from a trigger, because the
-- database is the thing that actually knows the change happened.
--
-- Two things fall out of this for free:
--
--   1. An event cannot exist without its change, or a change without its
--      event — they are literally the same statement.
--   2. A row written by a migration, a backfill or an admin's psql session
--      emits an event too. Application-level emission always misses those.

create or replace function public.emit_outbox(p_topic text, p_payload jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.outbox (topic, payload) values (p_topic, p_payload);
$$;

-- Not callable by a client: only the trigger functions below, which are
-- themselves security definer, ever reach it.
revoke all on function public.emit_outbox(text, jsonb) from public, anon, authenticated;

/* ── Posts ───────────────────────────────────────────────────────────────── */

create or replace function public.on_post_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.emit_outbox('post.created', jsonb_build_object(
    'postId', new.id,
    'authorId', new.author_id,
    'channelId', new.channel_id
  ));
  return null;
end;
$$;

drop trigger if exists posts_emit_created on public.posts;
create trigger posts_emit_created
  after insert on public.posts
  for each row execute function public.on_post_created();

/* ── Likes ───────────────────────────────────────────────────────────────── */

create or replace function public.on_post_liked()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  -- Liking your own post is not news. Filtering here rather than in the
  -- fan-out keeps a pointless row out of the queue entirely.
  if v_author is null or v_author = new.user_id then
    return null;
  end if;
  perform public.emit_outbox('post.liked', jsonb_build_object(
    'postId', new.post_id,
    'likedBy', new.user_id,
    'authorId', v_author
  ));
  return null;
end;
$$;

drop trigger if exists post_likes_emit on public.post_likes;
create trigger post_likes_emit
  after insert on public.post_likes
  for each row execute function public.on_post_liked();

/* ── Comments ────────────────────────────────────────────────────────────── */

create or replace function public.on_comment_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is null or v_author = new.author_id then
    return null;
  end if;
  perform public.emit_outbox('post.replied', jsonb_build_object(
    'postId', new.post_id,
    'commentId', new.id,
    'authorId', v_author,
    'repliedBy', new.author_id
  ));
  return null;
end;
$$;

drop trigger if exists post_comments_emit on public.post_comments;
create trigger post_comments_emit
  after insert on public.post_comments
  for each row execute function public.on_comment_created();

/* ── Courses ─────────────────────────────────────────────────────────────── */

create or replace function public.on_course_published()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only the transition. Unpublishing to fix a typo and republishing must not
  -- announce the course to the whole club a second time.
  if new.is_published and not old.is_published then
    perform public.emit_outbox('course.published', jsonb_build_object('courseId', new.id));
  end if;
  return null;
end;
$$;

drop trigger if exists courses_emit_published on public.courses;
create trigger courses_emit_published
  after update of is_published on public.courses
  for each row execute function public.on_course_published();

/* ── Account lifecycle ───────────────────────────────────────────────────── */

-- Deletion is scheduled by writing an activity_events row, which the API can
-- do under RLS. The outbox entry follows from it here.
create or replace function public.on_account_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('account.deletion_scheduled', 'account.deletion_cancelled') then
    perform public.emit_outbox(new.kind, new.payload || jsonb_build_object('userId', new.user_id));
  end if;
  return null;
end;
$$;

drop trigger if exists activity_events_emit on public.activity_events;
create trigger activity_events_emit
  after insert on public.activity_events
  for each row execute function public.on_account_event();

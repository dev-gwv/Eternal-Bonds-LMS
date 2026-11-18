-- Packages: a bundle of courses sold on its own, for a one-time price.
--
-- Until now the only way into a course was tier. A package is a second door:
-- a member who has bought "Wedding Business Masterclass" gets its courses
-- whatever their tier, for as long as the package says (or for good).
--
-- A course can also be *package-only*: then tier alone never opens it, not
-- even Franchisee. That is what makes a package worth buying for somebody
-- who is already Diamond — otherwise every Diamond course is a package they
-- already own.
--
-- Grants are rows, never a flag: who gave it, from which order, when it ends,
-- and a revoke that keeps the history. Razorpay inserts one when a package
-- order is paid; an admin inserts one by hand for a UPI or cash payment.

begin;

alter table public.courses add column if not exists package_only boolean not null default false;

create table if not exists public.packages (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  summary_md    text,
  cover_key     text,
  -- Paise, like plans. Money in a float is how ₹4,999 becomes ₹4,998.99.
  price_paise   integer not null default 0 check (price_paise >= 0),
  currency      text not null default 'INR',
  -- How long a purchase lasts. Null is for good.
  access_days   integer check (access_days is null or access_days > 0),
  is_published  boolean not null default false,
  rank          numeric not null default 1000,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.package_courses (
  package_id uuid not null references public.packages (id) on delete cascade,
  course_id  uuid not null references public.courses (id) on delete cascade,
  rank       numeric not null default 1000,
  primary key (package_id, course_id)
);
create index if not exists package_courses_course_idx on public.package_courses (course_id);

create table if not exists public.package_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  package_id  uuid not null references public.packages (id) on delete cascade,
  source      text not null default 'manual' check (source in ('manual', 'razorpay')),
  order_id    uuid references public.orders (id) on delete set null,
  granted_by  uuid references public.users (id) on delete set null,
  note        text,
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz
);
-- One live grant per member and package. Buying twice extends rather than
-- stacking (see grant_package below), and a revoked grant stays as history.
create unique index if not exists package_grants_live_key
  on public.package_grants (user_id, package_id) where revoked_at is null;
create index if not exists package_grants_package_idx on public.package_grants (package_id);

-- An order buys a plan *or* a package, never both and never neither.
alter table public.orders alter column plan_id drop not null;
alter table public.orders add column if not exists package_id uuid references public.packages (id);
alter table public.orders drop constraint if exists orders_one_product;
alter table public.orders add constraint orders_one_product check ((plan_id is null) <> (package_id is null));

commit;

begin;

alter table public.packages        enable row level security;
alter table public.package_courses enable row level security;
alter table public.package_grants  enable row level security;

-- A published package is a shop window: everybody signed in sees it, whatever
-- their tier. That is the point of it.
drop policy if exists packages_select on public.packages;
create policy packages_select on public.packages
  for select to authenticated using (is_published or public.is_admin());

drop policy if exists packages_admin_write on public.packages;
create policy packages_admin_write on public.packages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists package_courses_select on public.package_courses;
create policy package_courses_select on public.package_courses
  for select to authenticated
  using (exists (select 1 from public.packages p where p.id = package_id and (p.is_published or public.is_admin())));

drop policy if exists package_courses_admin_write on public.package_courses;
create policy package_courses_admin_write on public.package_courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- A member sees their own grants; only admins (and the service role, for
-- payment webhooks) write them.
drop policy if exists package_grants_select on public.package_grants;
create policy package_grants_select on public.package_grants
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists package_grants_admin_write on public.package_grants;
create policy package_grants_admin_write on public.package_grants
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Does the caller hold a live grant on a package containing this course?
-- Definer, because the policies on package_courses and package_grants must not
-- recurse into the course policies that call this.
create or replace function public.owns_course_package(p_course uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from package_grants g
    join package_courses pc on pc.package_id = g.package_id
    where g.user_id = auth.uid()
      and pc.course_id = p_course
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
  );
$$;
revoke all on function public.owns_course_package(uuid) from public, anon;
grant execute on function public.owns_course_package(uuid) to authenticated;

-- The one question every course gate asks: tier (unless package-only) or a
-- package. Replaces `tier_allows(c.min_tier)` wherever a course is gated.
create or replace function public.course_allowed(p_course uuid, p_min_tier public.tier, p_package_only boolean)
returns boolean
language sql
stable
as $$
  select (not p_package_only and public.tier_allows(p_min_tier)) or public.owns_course_package(p_course);
$$;

drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses
  for select to authenticated
  using ((is_published and public.course_allowed(id, min_tier, package_only)) or public.is_admin());

drop policy if exists modules_select on public.modules;
create policy modules_select on public.modules
  for select to authenticated
  using (
    exists (
      select 1 from public.courses c
      where c.id = course_id and c.is_published and public.course_allowed(c.id, c.min_tier, c.package_only)
    )
    or public.is_admin()
  );

drop policy if exists lessons_select on public.lessons;
create policy lessons_select on public.lessons
  for select to authenticated
  using (
    is_preview
    or exists (
      select 1 from public.modules m
      join public.courses c on c.id = m.course_id
      where m.id = module_id and c.is_published and public.course_allowed(c.id, c.min_tier, c.package_only)
    )
    or public.is_admin()
  );

drop policy if exists quiz_questions_select on public.quiz_questions;
create policy quiz_questions_select on public.quiz_questions
  for select to authenticated
  using (
    public.is_admin() or exists (
      select 1 from public.lessons l
      join public.modules m on m.id = l.module_id
      join public.courses c on c.id = m.course_id
      where l.id = lesson_id and c.is_published and public.course_allowed(c.id, c.min_tier, c.package_only)
    )
  );

-- Definer functions do their own reachability check (they bypass the
-- policies above). Rewrite every one that gates on a course's tier, in place,
-- rather than copying their bodies here and letting the two drift.
do $$
declare
  f record;
  def text;
begin
  for f in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc like '%tier_allows(c.min_tier)%'
  loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'public.tier_allows(c.min_tier)', 'public.course_allowed(c.id, c.min_tier, c.package_only)');
    execute def;
  end loop;
end $$;

-- What a package contains, readable by anyone who can see the package.
--
-- `package_courses` joins `courses`, and `courses_select` hides what the member
-- cannot open — which for a package they have not bought is exactly the
-- courses they would be buying. Like `journey_step_catalogue`, this returns
-- the catalogue entry only (title, cover, length), never lessons or video.
create or replace function public.package_catalogue(p_package uuid)
returns table (
  course_id     uuid,
  course_slug   text,
  course_title  text,
  cover_key     text,
  instructor    text,
  lesson_count  int,
  seconds       int,
  rank          numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.slug, c.title, c.cover_key, c.instructor_name,
    (select count(*)::int from lessons l join modules m on m.id = l.module_id where m.course_id = c.id),
    (select coalesce(sum(l.duration_seconds), 0)::int from lessons l join modules m on m.id = l.module_id where m.course_id = c.id),
    pc.rank
  from package_courses pc
  join courses c on c.id = pc.course_id
  join packages p on p.id = pc.package_id
  where pc.package_id = p_package
    and (p.is_published or public.is_admin())
    and (c.is_published or public.is_admin())
  order by pc.rank asc;
$$;
revoke all on function public.package_catalogue(uuid) from public, anon;
grant execute on function public.package_catalogue(uuid) to authenticated;

-- Grants a package: a new live grant, or an extension of the existing one.
-- One function for the webhook and the admin button, so "bought it twice"
-- means the same thing whichever door it came through. Extends from the later
-- of now and the current end, so renewing early never loses days.
create or replace function public.grant_package(
  p_user uuid, p_package uuid, p_source text, p_order uuid, p_by uuid, p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int;
  v_id uuid;
  v_expires timestamptz;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can give a package';
  end if;
  select access_days into v_days from packages where id = p_package;
  if not found then raise exception 'Unknown package'; end if;

  select id, expires_at into v_id, v_expires
  from package_grants
  where user_id = p_user and package_id = p_package and revoked_at is null
  for update;

  if v_id is null then
    insert into package_grants (user_id, package_id, source, order_id, granted_by, note, expires_at)
    values (p_user, p_package, p_source, p_order, p_by, p_note,
            case when v_days is null then null else now() + make_interval(days => v_days) end)
    returning id into v_id;
  elsif v_expires is not null then
    update package_grants
    set expires_at = case when v_days is null then null
                          else greatest(v_expires, now()) + make_interval(days => v_days) end,
        order_id = coalesce(p_order, order_id)
    where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.grant_package(uuid, uuid, text, uuid, uuid, text) from public, anon;
grant execute on function public.grant_package(uuid, uuid, text, uuid, uuid, text) to authenticated, service_role;

drop trigger if exists packages_touch on public.packages;
create trigger packages_touch before update on public.packages
  for each row execute function public.touch_updated_at();

commit;

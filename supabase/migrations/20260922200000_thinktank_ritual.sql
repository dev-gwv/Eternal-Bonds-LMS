-- The notification kind the weekly ritual sends.
--
-- Everything else the ritual needs already existed — vote_cycles with a
-- status, insights.featured_at, events.is_featured_session, a
-- promote-recording endpoint. What was missing was a clock, not a schema.

begin;

alter type public.notification_kind add value if not exists 'thinktank.featured';

commit;

begin;

-- Events were created by hand, so nothing enforced unique slugs — which the
-- ritual relies on to be idempotent: closing the same cycle twice must not
-- create two sessions.
create unique index if not exists events_slug_key on public.events (slug);

commit;

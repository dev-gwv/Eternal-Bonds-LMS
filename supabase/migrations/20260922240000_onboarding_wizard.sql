-- The first-run setup flow.
--
-- Two additions, both small, both about letting a member out.
--
-- `onboarding_dismissed_at` is the escape hatch. A setup wizard that a member
-- cannot leave is a hostage situation, and the ones who most want to skip it
-- are the ones who already know what they want — exactly the members worth
-- keeping. Skipping is recorded server-side rather than in localStorage,
-- because a per-device flag means the wizard reappears on their phone, which
-- reads as the app having forgotten them.
--
-- And a profile step that asks for a photograph is a step most people will not
-- finish on a laptop, so the completeness check moves from avatar to bio: a
-- line about what you shoot is something a member can actually produce in the
-- thirty seconds they are giving this, and unlike an avatar it is rendered
-- somewhere real (the directory).

begin;

alter table public.users
  add column if not exists onboarding_dismissed_at timestamptz;

comment on column public.users.onboarding_dismissed_at is
  'Set when a member skips the setup flow. Stops the wizard reappearing, on every device, without pretending they finished it.';

commit;

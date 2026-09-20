-- Make the sign-up trigger understand OAuth providers.
--
-- It read `raw_user_meta_data ->> 'full_name'` only, which is what email and
-- phone sign-ups carry. Google returns the display name under `name` and the
-- photo under `picture`, and which of `full_name`/`name` is populated depends
-- on the flow. A member signing in with Google could therefore land with their
-- email prefix as their display name and no avatar — recoverable, but a poor
-- first impression on the one screen that introduces them to the club.
--
-- Falls through every shape rather than guessing which one a provider uses.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_handle text;
  meta jsonb;
begin
  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  base_handle := split_part(coalesce(new.email, new.phone, new.id::text), '@', 1);

  insert into public.users (id, handle, member_code, full_name, email, phone, avatar_url)
  values (
    new.id,
    base_handle || '-' || substr(new.id::text, 1, 4),
    'IPC-' || lpad((floor(random() * 99999))::text, 5, '0'),
    -- full_name: email/phone sign-ups. name: Google, and most OAuth providers.
    -- Trimmed because a provider sending "  " is worse than sending nothing.
    coalesce(
      nullif(trim(meta ->> 'full_name'), ''),
      nullif(trim(meta ->> 'name'), ''),
      base_handle
    ),
    new.email,
    new.phone,
    -- avatar_url is the Supabase convention; picture is Google's own claim.
    coalesce(nullif(meta ->> 'avatar_url', ''), nullif(meta ->> 'picture', ''))
  )
  on conflict (id) do nothing;

  -- Everyone starts free; a paid tier is granted by the payment webhook.
  insert into public.memberships (user_id, tier, status, source)
  values (new.id, 'free', 'active', 'signup');

  return new;
end;
$$;

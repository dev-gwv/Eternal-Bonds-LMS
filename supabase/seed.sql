-- Seed content. An empty board is the fastest way to make a community look
-- dead (PLAN.md §10.1), so a fresh database starts with real club material.
--
-- Members are NOT seeded here: they arrive through Supabase Auth, and the
-- on_auth_user_created trigger creates their profile.

insert into public.channels (slug, name, visibility, min_tier) values
  ('wins',           'Share your WINs', 'public', 'free'),
  ('announcements',  'Announcements',   'public', 'free'),
  ('ask-for-help',   'Ask for help',    'public', 'free'),
  ('introductions',  'Introductions',   'public', 'free')
on conflict (slug) do nothing;

insert into public.library_categories (slug, name, blurb, unit, rank) values
  ('business-docs',   'Business Docs',     'Quotation · T&Cs · Fees',            'files',  '100'),
  ('templates',       'Templates',         'Ads · Followers · Campaigns',        'files',  '200'),
  ('scripts',         'Scripts',           'Sales · Inquiry · Messaging',        'files',  '300'),
  ('winning-ads',     'Winning Ads',       'High-performing creatives',          'files',  '400'),
  ('quick-links',     'Quick Links',       'Sadhana · Meditation · Portfolio',   'links',  '500'),
  ('photo-library',   'Photo Library',     'Curated images to use',              'images', '600'),
  ('training-videos', 'Training & Videos', 'Recordings · Courses · Tutorials',   'videos', '700')
on conflict (slug) do nothing;

insert into public.courses (slug, title, category, level, language, min_tier, is_published, rank) values
  ('diamond-crash-course-english',    'Diamond Crash Course — English',              'business',   'beginner',     'english', 'diamond', true, '100'),
  ('photography-business-from-zero',  'How to Start your Photography Business from Zero', 'marketing', 'beginner', 'hindi',   'diamond', true, '200'),
  ('mindset-mastery',                 'Mindset Mastery — Successful Mind Secrets',   'mindset',    'intermediate', 'hindi',   'diamond', true, '300'),
  ('mission-1-crore',                 'Mission 1 Crore — Create Your Game Plan',     'business',   'advanced',     'hindi',   'diamond', true, '400'),
  ('team-building-secrets',           'Team Building Secrets',                       'operations', 'beginner',     'hindi',   'diamond', true, '500'),
  ('sales-force-secrets',             'Sales Force Secrets',                         'sales',      'intermediate', 'hindi',   'diamond', true, '600'),
  ('law-of-attraction',               'The Law of Attraction',                       'mindset',    'beginner',     'hindi',   'diamond', true, '700'),
  ('diamond-weekly-recordings',       'Diamond Weekly Session Recordings',           'sessions',   'all',          'hindi',   'diamond', true, '800')
on conflict (slug) do nothing;

-- One module + lesson per course so the player has something to open.
insert into public.modules (course_id, title, rank)
select c.id, 'Section 1', '100' from public.courses c
where not exists (select 1 from public.modules m where m.course_id = c.id);

insert into public.lessons (module_id, slug, title, duration_seconds, video_status, is_preview, rank)
select m.id, 'welcome', 'Start here', 480, 'ready', true, '100'
from public.modules m
where not exists (select 1 from public.lessons l where l.module_id = m.id);

insert into public.workshops (title, host_name, starts_at, ends_at, platform, recurring, occurrence_index, occurrence_total, min_tier) values
  ('New Diamond Members Planning Call', 'Eternal Bonds',
   date_trunc('day', now()) + interval '2 day' + interval '9 hour',
   date_trunc('day', now()) + interval '2 day' + interval '14 hour',
   'zoom_webinar', true, 50, 405, 'diamond'),
  ('Laser-Targeted Marketing Ads with Aman Saifi', 'Aman Saifi',
   date_trunc('day', now()) + interval '3 day' + interval '12 hour',
   date_trunc('day', now()) + interval '3 day' + interval '15 hour',
   'zoom_webinar', false, null, null, 'diamond'),
  ('Diamond Weekly Calls by Abdullah Ansari — Action Mode ON', 'Abdullah Ansari',
   date_trunc('day', now()) + interval '4 day' + interval '11 hour',
   date_trunc('day', now()) + interval '4 day' + interval '16 hour',
   'zoom_webinar', true, 70, 97, 'diamond')
on conflict do nothing;

-- Think Tank lookups + an open vote cycle so the first insight has somewhere
-- to compete. Insights and wins themselves are seeded by the founding cohort
-- (PLAN §10.1) — they need real authors, not fixture users.
insert into public.insight_impact_areas (slug, name, rank) values
  ('growth','Growth','100'),('profit','Profit','200'),('time','Time','300'),
  ('team','Team','400'),('brand','Brand','500')
on conflict (slug) do nothing;

insert into public.vote_cycles (starts_on, ends_on, status) values
  (current_date - (extract(dow from current_date)::int + 6) % 7,
   current_date - (extract(dow from current_date)::int + 6) % 7 + 6, 'open')
on conflict do nothing;

insert into public.solutions (dilemma, body_md, rank) values
  ('Clients ask for discounts on every shoot',
   'Hold price, shrink scope: offer the same rate for fewer deliverables, never the same deliverables for less money.',
   '100'),
  ('No enquiries between wedding seasons',
   'Run a same-city mini-shoot weekend for past clients — the cheapest lead is someone who already paid you.',
   '200'),
  ('Editing backlog eats the weekends',
   'Cap revisions at two rounds in writing, batch-edit one day a week, outsource culling first — it is the cheapest hour to buy.',
   '300')
on conflict do nothing;

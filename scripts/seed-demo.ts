/**
 * Realistic content, so the app can be looked at rather than imagined.
 *
 *   bun run db:seed-demo          create it
 *   bun run db:seed-demo -- --clear   remove everything it made
 *
 * Every empty page in this app is a page nobody has really seen. A feed with
 * no posts, a wins board with no wins and a roster of two is not a product
 * you can judge — most bugs in a list only appear at the second item, and
 * every "is this readable?" question needs real sentence lengths and real
 * Indian names to answer.
 *
 * Everything it writes is tagged `demo-<stamp>` in its slug or email, and
 * `--clear` removes exactly that. It never touches a row it did not create,
 * which is the whole reason it is safe to run against the real database.
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const db = createDb(url, { max: 1 });
const clear = process.argv.includes('--clear');

/** One marker, so cleanup is exact. */
const TAG = 'demo';

const MEMBERS = [
  ['Ananya Iyer', 'Bengaluru', 'diamond', 'Wedding and portrait work out of Bengaluru. Seven years in, mostly South Indian weddings.', ['weddings', 'portraits']],
  ['Rohit Malhotra', 'Delhi', 'silver', 'Editorial and brand shoots. I came from advertising and still think in campaigns.', ['editorial', 'brands', 'lighting']],
  ['Meera Nair', 'Kochi', 'diamond', 'Destination weddings across Kerala and Goa. Two-person team, everything shot on primes.', ['weddings', 'destination']],
  ['Karan Bhatia', 'Mumbai', 'free', 'Two years in, shooting pre-weddings while I build a portfolio worth charging for.', ['pre-wedding']],
  ['Priya Deshmukh', 'Pune', 'silver', 'Newborn and family work. Studio at home, which changed the economics completely.', ['newborn', 'family']],
  ['Aditya Rao', 'Hyderabad', 'diamond', 'Weddings and the occasional corporate event. I price by day, never by deliverable.', ['weddings', 'corporate', 'pricing']],
  ['Sneha Kulkarni', 'Nagpur', 'free', 'Just starting. Second shooter on eleven weddings so far, looking for my first solo booking.', ['second-shooter']],
  ['Vikram Singh', 'Jaipur', 'franchisee', 'Heritage and palace weddings in Rajasthan. I run a team of four.', ['weddings', 'heritage', 'teams']],
] as const;

const POSTS = [
  ['ask-for-help', 'Client wants RAW files after delivery. I have never given RAWs and my contract does not mention them. How do you all handle this one?'],
  ['wins', 'Booked my first ₹1.5L wedding this morning. The enquiry came from a reel I almost did not post.'],
  ['ask-for-help', 'Anyone shooting on the R6 II — how are you finding autofocus in low light receptions? Mine hunts badly past 10pm.'],
  ['introductions', 'Hello from Pune. Newborn and family work, home studio. Here mostly to fix my pricing, which I know is too low.'],
  ['wins', 'Raised my package from 45k to 70k in January. Lost two enquiries, booked four. Should have done it two years ago.'],
  ['ask-for-help', 'How long is everyone taking for delivery? I promise four weeks and I am consistently at six, which is starting to hurt.'],
  ['announcements', 'Reminder: this week’s Think Tank is on Thursday at 7pm. Bring one pricing question.'],
] as const;

const WINS = [
  [
    'The same-evening quotation that doubled my close rate',
    'revenue',
    'Send the quote before you leave the meeting, not the next morning. Nothing else changed.',
    'I used to go home, build a nice PDF and send it the next day. Roughly one in five converted. Now I keep three packages in a note on my phone, and before I stand up I say "I will send this now" and send it while we are still sitting there. Close rate went from about 20% to just over 40% across fourteen enquiries. The PDF never mattered — the gap did.',
  ],
  [
    'Stopped offering unlimited edits and nobody complained',
    'clients',
    'Two rounds of revisions, written into the contract. The fear of pushback was worse than the pushback.',
    'Every delivery used to trail on for weeks over small edits. I put "two rounds of revisions" into the contract in March and said it out loud in the first meeting. Twenty-two bookings since. One person asked about it, accepted the answer in a sentence, and booked anyway. My delivery time dropped from six weeks to three, which got me two extra shoots in the season.',
  ],
  [
    'Raised prices 40% and booked more, not fewer',
    'revenue',
    'The enquiries I lost were the ones that were costing me money anyway.',
    'I went from 50k to 70k for the full-day package in January, terrified. Enquiries dropped by about a third. Bookings went *up*, because the people who were price-shopping were also the ones who took eight emails to close and asked for the most edits. I earned more in four months than in the previous nine.',
  ],
] as const;

const INSIGHTS = [
  ['Charge for the album separately, always', 'Bundling the album hides your best margin inside a number people negotiate.'],
  ['Book the second shooter before you need one', 'The good ones are gone by October. Retainers cost less than a cancelled booking.'],
  ['Answer enquiries within the hour, not the day', 'Most couples message three photographers. The first real reply usually wins.'],
] as const;

async function wipe() {
  console.log('\nRemoving demo content');
  const tables: [string, string][] = [
    ['posts', `delete from posts where body_md in (${POSTS.map(() => '?').join(',')})`],
  ];
  void tables;

  // Order matters only where there is no cascade.
  await db.execute(sql`delete from wins where slug like ${`${TAG}-%`}`);
  await db.execute(sql`delete from insights where slug like ${`${TAG}-%`}`);
  await db.execute(sql`delete from journeys where slug like ${`${TAG}-%`}`);
  await db.execute(sql`delete from cohorts where slug like ${`${TAG}-%`}`);
  await db.execute(sql`delete from events where slug like ${`${TAG}-%`}`);
  await db.execute(sql`delete from library_items where title like ${`[${TAG}]%`}`);
  // Posts have no slug, so they go by author — every demo member is deleted
  // anyway and the cascade would take them, but being explicit is cheaper
  // than trusting a foreign key somebody may relax later.
  await db.execute(sql`
    delete from posts where author_id in (select id from users where email like ${`${TAG}-%@example.test`})
  `);
  const gone = await db.execute<{ id: string }>(sql`
    delete from auth.users where email like ${`${TAG}-%@example.test`} returning id
  `);
  console.log(`  removed ${gone.length} demo member(s) and their content`);
}

async function main() {
  if (clear) {
    await wipe();
    return;
  }

  // Idempotent: running twice should not produce sixteen members.
  await wipe();

  console.log('\nMembers');
  const ids: string[] = [];
  for (const [i, [name, city, tier, bio, expertise]] of MEMBERS.entries()) {
    const id = crypto.randomUUID();
    const email = `${TAG}-${i}@example.test`;
    await db.execute(sql`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
      values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, '', now(), now(), now(), '{}'::jsonb, ${JSON.stringify({ full_name: name })}::jsonb)
    `);
    await db.execute(sql`
      update users set city = ${city}, created_at = now() - ${`${40 - i * 4} days`}::interval where id = ${id}
    `);
    await db.execute(sql`
      insert into memberships (user_id, tier, status, source)
      values (${id}, ${tier}::public.tier, 'active', 'demo')
    `);
    await db.execute(sql`
      insert into member_profiles (user_id, bio_md, expertise, show_in_directory)
      values (${id}, ${bio}, ${`{${expertise.join(',')}}`}::text[], true)
      on conflict (user_id) do update set bio_md = excluded.bio_md, expertise = excluded.expertise
    `);
    ids.push(id);
  }
  console.log(`  ${ids.length} members, across 4 tiers and 8 cities`);

  console.log('\nCommunity');
  for (const [i, [channel, body]] of POSTS.entries()) {
    const [ch] = await db.execute<{ id: string }>(sql`select id from channels where slug = ${channel}`);
    if (!ch) continue;
    await db.execute(sql`
      insert into posts (channel_id, author_id, body_md, created_at)
      values (${ch.id}, ${ids[i % ids.length]}, ${body}, now() - ${`${i * 7} hours`}::interval)
    `);
  }
  console.log(`  ${POSTS.length} posts across 4 channels`);

  console.log('\nWins');
  for (const [i, [title, category, big, how]] of WINS.entries()) {
    await db.execute(sql`
      insert into wins (author_id, slug, title, big_idea_md, how_it_happened_md, category, status, public_share, created_at)
      values (${ids[i]}, ${`${TAG}-win-${i}`}, ${title}, ${big}, ${how}, ${category}, 'published',
              ${i === 0}, now() - ${`${i * 3 + 1} days`}::interval)
    `);
  }
  console.log(`  ${WINS.length} wins, one shared publicly`);

  console.log('\nThink Tank');
  const [cycle] = await db.execute<{ id: string }>(sql`
    select id from vote_cycles where status = 'open' order by starts_on desc limit 1
  `);
  for (const [i, [title, idea]] of INSIGHTS.entries()) {
    await db.execute(sql`
      insert into insights (author_id, vote_cycle_id, slug, title, situation_md, big_idea_md, how_md, status, votes_count)
      values (${ids[i + 2]}, ${cycle?.id ?? null}, ${`${TAG}-insight-${i}`}, ${title},
              'Something most photographers here run into.', ${idea},
              'Try it on the next three enquiries and compare.', 'published', ${9 - i * 3})
    `);
  }
  console.log(`  ${INSIGHTS.length} insights in the open voting cycle`);

  console.log('\nLearning');
  const courses = await db.execute<{ id: string; title: string }>(sql`
    select id, title from courses where is_published order by created_at limit 4
  `);

  if (courses.length >= 2) {
    const [journey] = await db.execute<{ id: string }>(sql`
      insert into journeys (slug, title, promise, description_md, min_tier, is_published)
      values (${`${TAG}-first-paid-wedding`}, 'Zero to your first paid wedding',
              'Book your first paid wedding within three months',
              'Pricing, then the pitch, then the shoot. In that order, because you cannot sell what you cannot quote.',
              'free', true)
      returning id
    `);
    for (const [i, c] of courses.entries()) {
      await db.execute(sql`
        insert into journey_steps (journey_id, course_id, note, rank)
        values (${journey!.id}, ${c.id},
                ${i === 0 ? 'Start here — everything after this assumes it.' : 'Builds directly on the last one.'},
                ${(i + 1) * 1000})
      `);
    }
    console.log(`  1 journey with ${courses.length} steps`);

    // A cohort on the first course, started a fortnight ago.
    const [cohort] = await db.execute<{ id: string }>(sql`
      insert into cohorts (course_id, slug, name, starts_on, ends_on, capacity, is_open)
      values (${courses[0]!.id}, ${`${TAG}-january`}, 'January group',
              current_date - 14, current_date + 28, 25, true)
      returning id
    `);
    for (const id of ids.slice(0, 5)) {
      await db.execute(sql`
        insert into enrollments (user_id, course_id) values (${id}, ${courses[0]!.id})
        on conflict (user_id, course_id) do nothing
      `);
      await db.execute(sql`
        insert into cohort_members (cohort_id, user_id, course_id)
        values (${cohort!.id}, ${id}, ${courses[0]!.id})
        on conflict do nothing
      `);
    }
    console.log('  1 cohort with 5 members, running since day 14');

    // Progress, spread out — so the roster has people ahead and behind rather
    // than a column of identical zeroes.
    const lessons = await db.execute<{ id: string }>(sql`
      select l.id from lessons l join modules m on m.id = l.module_id
      where m.course_id = ${courses[0]!.id} order by m.rank, l.rank
    `);
    for (const [i, id] of ids.slice(0, 5).entries()) {
      const take = Math.max(0, Math.floor(lessons.length * [1, 0.7, 0.4, 0.15, 0][i]!));
      for (const l of lessons.slice(0, take)) {
        await db.execute(sql`
          insert into lesson_progress (user_id, lesson_id, watch_seconds, is_completed, completed_at, updated_at)
          values (${id}, ${l.id}, 600, true, now() - ${`${i + 1} days`}::interval, now() - ${`${i + 1} days`}::interval)
          on conflict (user_id, lesson_id) do nothing
        `);
      }
    }
    console.log(`  progress spread across ${lessons.length} lessons, 0% to 100%`);
  } else {
    console.log('  skip — needs at least 2 published courses');
  }

  console.log('\nEvents');
  await db.execute(sql`
    insert into events (slug, title, description_md, starts_at, ends_at, is_featured_session, min_tier)
    values (${`${TAG}-think-tank`}, 'Think Tank: charging for the album separately',
            'This week''s most-voted insight, worked through live.',
            now() + interval '3 days', now() + interval '3 days 1 hour', true, 'free')
  `);
  await db.execute(sql`
    insert into events (slug, title, description_md, starts_at, ends_at, is_featured_session, min_tier)
    values (${`${TAG}-pricing-clinic`}, 'Pricing clinic',
            'Bring one package. Leave with one that sells.',
            now() - interval '5 days', now() - interval '5 days' + interval '1 hour', false, 'free')
  `);
  console.log('  2 events, one upcoming and one finished');

  console.log('\nLibrary');
  const [cat] = await db.execute<{ id: string }>(sql`select id from library_categories limit 1`);
  if (cat) {
    for (const [title, href] of [
      ['[demo] Quotation template', 'https://example.com/quotation'],
      ['[demo] Wedding day shot list', 'https://example.com/shotlist'],
      ['[demo] Contract with two revision rounds', 'https://example.com/contract'],
    ] as const) {
      await db.execute(sql`
        insert into library_items (category_id, title, external_url, min_tier)
        values (${cat.id}, ${title}, ${href}, 'free')
      `);
    }
    console.log('  3 library items');
  }

  console.log('\nDone. Run with --clear to remove all of it.\n');
}

try {
  await main();
} finally {
  await db.$client.end({ timeout: 5 });
}

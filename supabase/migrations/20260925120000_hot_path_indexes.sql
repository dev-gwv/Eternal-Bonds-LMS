-- Indexes for the queries that run whether or not anybody is looking.
--
-- Every table in this database is currently small enough that Postgres picks a
-- sequential scan and is right to. That is exactly why this is worth doing now
-- and not later: the plans that are fine at two hundred rows are the ones that
-- fall over at two hundred thousand, and by then the fix arrives during an
-- incident rather than before one.
--
-- Each index below is justified by a query that exists in this codebase today,
-- not by a foreign key existing. There are forty foreign keys without a
-- leading index and most of them should stay that way — an index nothing reads
-- is write amplification and disk for nothing.

begin;

/* The outbox drain, every thirty seconds, forever.
   `select ... where processed_at is null order by created_at limit 50` against
   a table whose only index is its primary key. Already a seq scan discarding
   195 rows to find 3, and the ratio only worsens because processed rows are
   never deleted.
   Partial, so the index holds only the backlog — a few rows in steady state,
   however large the table grows — and it serves the ORDER BY as well as the
   filter, which removes the sort too. */
create index if not exists outbox_unprocessed_idx
  on public.outbox (created_at) where processed_at is null;

/* Every course page, every progress rollup, every journey step.
   `modules` had nothing but a primary key, so `where course_id = ?` scanned
   the whole table — on the single most-read path in the application. Rank is
   included because every one of those reads is ordered by it. */
create index if not exists modules_course_rank_idx on public.modules (course_id, rank);

/* Lesson-wide progress reads.
   `lesson_progress` has (user_id, lesson_id), which serves "this member's
   progress" perfectly and cannot serve "everyone's progress on this lesson" —
   the admin roster, the cohort view, and the per-lesson completion counts all
   filter lesson-first. */
create index if not exists lesson_progress_lesson_idx on public.lesson_progress (lesson_id);

/* The community feed loads media for a page of posts in one `where post_id in
   (...)`. With only a primary key that is a full scan per feed render. */
create index if not exists post_media_post_idx on public.post_media (post_id);

/* The shelf counts on the library page: one correlated count per category. */
create index if not exists library_items_category_idx on public.library_items (category_id);

/* A member's own posts — the profile, and the moderation view of somebody's
   history. Ordered, because both read newest first. */
create index if not exists posts_author_idx on public.posts (author_id, created_at desc);

/* Course-first enrolment reads: the studio's per-course counts and the
   revenue rollups. The existing index is (user_id, course_id), which is
   member-first and cannot serve these. */
create index if not exists enrollments_course_idx on public.enrollments (course_id);

commit;

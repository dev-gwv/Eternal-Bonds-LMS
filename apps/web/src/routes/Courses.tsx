import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { Course } from '@ipc/contracts';
import { api, durationLabel } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { LoadingLabel, SkeletonCard } from '../shared/ui/Skeleton.tsx';
import { ProgressRing } from '../shared/ui/charts.tsx';
import { Chip, Dropdown, Icon } from '../shared/ui/primitives.tsx';
import { Select } from '../shared/ui/Select.tsx';

const CATEGORY_TONE: Record<Course['category'], { text: string; gradient: string; on: string }> = {
  business: { text: 'var(--pink-ink)', gradient: 'linear-gradient(135deg, #f9a8c9 0%, #f27fb0 100%)', on: '#fff' },
  marketing: { text: 'var(--yellow-ink)', gradient: 'linear-gradient(135deg, #fcd34d 0%, #f5b400 100%)', on: '#6b4e00' },
  mindset: { text: 'var(--blue-ink)', gradient: 'linear-gradient(135deg, #bbd3f5 0%, #7fa9e8 100%)', on: '#1f4477' },
  sales: { text: 'var(--yellow-ink)', gradient: 'linear-gradient(135deg, #ffd9a8 0%, #f5a623 100%)', on: '#6b3d00' },
  operations: { text: 'var(--green-ink)', gradient: 'linear-gradient(135deg, #a8e6cf 0%, #4fc3a1 100%)', on: '#0e4f3c' },
  sessions: { text: 'var(--pink-ink)', gradient: 'linear-gradient(135deg, #ffc3d6 0%, #f48fb1 100%)', on: '#7a1140' },
};

const RING: Record<Course['category'], string> = {
  business: 'var(--s1)',
  marketing: 'var(--s2)',
  mindset: 'var(--s3)',
  sales: 'var(--s2)',
  operations: 'var(--s1)',
  sessions: 'var(--s2)',
};

const FILTERS = ['all', 'business', 'marketing', 'mindset', 'sales', 'operations'] as const;

function StatusChip({ status }: { status: Course['status'] }) {
  if (status === 'completed') return <Chip tone="green"><Icon name="check" size={11} strokeWidth={3} />Completed</Chip>;
  if (status === 'ongoing') return <Chip tone="yellow">Ongoing</Chip>;
  return <Chip>Not started</Chip>;
}

function CourseCard({ course }: { course: Course }) {
  const tone = CATEGORY_TONE[course.category];
  return (
    <Link
      to="/courses/$slug"
      params={{ slug: course.slug }}
      className="card"
      style={{ padding: 12, gap: 10, color: 'inherit' }}
    >
      <div
        style={{
          height: 104,
          borderRadius: 11,
          background: tone.gradient,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 12px',
          textAlign: 'center',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: tone.on, letterSpacing: '0.04em' }}>
          {course.title.split('—')[0]!.trim().toUpperCase()}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.35 }}>{course.title}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontSize: 10, color: tone.text, textTransform: 'capitalize' }}>{course.category}</span>
          <span style={{ fontSize: 10, textTransform: 'capitalize' }} className="dim">{course.level}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10 }} className="muted">
          <Icon name="play" size={12} strokeWidth={1.9} color="var(--ink-3)" />
          {course.lessonCount}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10 }} className="muted">
          <Icon name="clock" size={12} strokeWidth={1.9} color="var(--ink-3)" />
          {durationLabel(course.durationMinutes)}
        </span>
        <span style={{ flex: 1 }} />
        <StatusChip status={course.status} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 9, borderTop: '1px solid var(--softer)' }}>
        <ProgressRing value={course.progress} size={26} color={RING[course.category]} />
        <span style={{ flex: 1, fontSize: 11 }} className="muted">{course.progress}%</span>
        {course.score === null ? (
          <span style={{ fontSize: 11 }} className="dim">—</span>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600 }} className="num">
            {course.score}
            <span style={{ fontSize: 9, fontWeight: 400 }} className="dim">/100</span>
          </span>
        )}
      </div>
    </Link>
  );
}

const STATUSES = ['all', 'not_started', 'ongoing', 'completed'] as const;
const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = {
  all: 'All status',
  not_started: 'Not started',
  ongoing: 'Ongoing',
  completed: 'Completed',
};

export function CoursesPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const [query, setQuery] = useState('');
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api.courses() });

  const needle = query.trim().toLowerCase();
  const rows = (courses.data ?? []).filter(
    (c) =>
      (filter === 'all' || c.category === filter) &&
      (status === 'all' || c.status === status) &&
      // Filtering here rather than round-tripping: the whole catalogue is
      // already loaded, and a network hop per keystroke would be slower than
      // the scan by orders of magnitude.
      (needle === '' || c.title.toLowerCase().includes(needle) || c.category.toLowerCase().includes(needle)),
  );
  const filtered = filter !== 'all' || status !== 'all' || needle !== '';

  return (
    <Page>
      <PageHeader
        title="Courses"
        crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Courses' }]}
        actions={
          <>
            <div className="search">
              <label htmlFor="course-search" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Search course
              </label>
              <input
                id="course-search"
                type="search"
                value={query}
                placeholder="Search course, category, etc"
                onChange={(e) => setQuery(e.target.value)}
              />
              <Icon name="search" size={14} strokeWidth={2} color="var(--ink-2)" />
            </div>
            <Select
              value={status}
              aria-label="Filter by status"
              options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              onChange={(next) => setStatus(next as (typeof STATUSES)[number])}
            />
            {filtered && (
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => {
                  setFilter('all');
                  setStatus('all');
                  setQuery('');
                }}
              >
                Clear
              </button>
            )}
          </>
        }
      />

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={filter === f ? 'btn btn-pink' : 'btn btn-soft'}
            style={{ padding: '7px 15px', textTransform: 'capitalize' }}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {courses.isPending && (
        <>
          <LoadingLabel>Loading courses</LoadingLabel>
          <div className="grid grid-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} height={104} lines={2} />)}
          </div>
        </>
      )}
      {courses.isError && <p style={{ fontSize: 12, color: 'var(--red)' }}>Could not load courses.</p>}

      <div className="grid grid-4" style={{ alignContent: 'start' }}>
        {rows.map((c) => <CourseCard key={c.id} course={c} />)}
      </div>
    </Page>
  );
}

/* A native select, styled to match the pill buttons beside it. Native because
   it is keyboard-accessible, works on a phone, and needs no state of its own —
   the custom dropdown it replaces did none of those and did not open. */
const selectStyle: React.CSSProperties = {
  font: 'inherit',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--ink-2)',
  background: 'var(--soft)',
  border: 0,
  borderRadius: 'var(--r-pill)',
  padding: '9px 14px',
};

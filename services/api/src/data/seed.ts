import type {
  ActivityDay,
  Channel,
  Course,
  DashboardStats,
  LeaderboardRow,
  LibraryCategory,
  Member,
  Performance,
  Post,
  Workshop,
} from '@ipc/contracts';

/**
 * Seed content the API serves until Postgres is wired up.
 * It is real club content on purpose: an empty board is the fastest way
 * to make a new community look dead. See PLAN.md §10.1.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const member: Member = {
  id: id(1),
  memberCode: 'IPC-4821',
  fullName: 'Aditya Kulkarni',
  initials: 'AK',
  tier: 'diamond',
  active: true,
  joinedAt: '2026-01-30T00:00:00.000Z',
  email: 'aditya.kulkarni@email.com',
  phone: '+91 98220 41552',
  city: 'Kothrud, Pune, Maharashtra',
  socials: [
    { network: 'LinkedIn', handle: 'aditya-kulkarni' },
    { network: 'Instagram', handle: '@adityaclicks' },
  ],
};

export const courses: Course[] = [
  {
    id: id(10),
    slug: 'diamond-crash-course-english',
    title: 'Diamond Crash Course — English',
    category: 'business',
    level: 'beginner',
    language: 'english',
    lessonCount: 9,
    durationMinutes: 1500,
    minTier: 'diamond',
    progress: 62,
    status: 'ongoing',
    score: 78,
    certificateUrl: null,
  },
  {
    id: id(11),
    slug: 'photography-business-from-zero',
    title: 'How to Start your Photography Business from Zero',
    category: 'marketing',
    level: 'beginner',
    language: 'hindi',
    lessonCount: 20,
    durationMinutes: 2400,
    minTier: 'diamond',
    progress: 50,
    status: 'ongoing',
    score: 72,
    certificateUrl: null,
  },
  {
    id: id(12),
    slug: 'mindset-mastery',
    title: 'Mindset Mastery — Successful Mind Secrets',
    category: 'mindset',
    level: 'intermediate',
    language: 'hindi',
    lessonCount: 18,
    durationMinutes: 1800,
    minTier: 'diamond',
    progress: 100,
    status: 'completed',
    score: 90,
    certificateUrl: '/certificates/mindset-mastery.pdf',
  },
  {
    id: id(13),
    slug: 'mission-1-crore',
    title: 'Mission 1 Crore — Create Your Game Plan',
    category: 'business',
    level: 'advanced',
    language: 'hindi',
    lessonCount: 19,
    durationMinutes: 1740,
    minTier: 'diamond',
    progress: 35,
    status: 'ongoing',
    score: 64,
    certificateUrl: null,
  },
  {
    id: id(14),
    slug: 'team-building-secrets',
    title: 'Team Building Secrets',
    category: 'operations',
    level: 'beginner',
    language: 'hindi',
    lessonCount: 5,
    durationMinutes: 960,
    minTier: 'diamond',
    progress: 46,
    status: 'ongoing',
    score: 66,
    certificateUrl: null,
  },
  {
    id: id(15),
    slug: 'sales-force-secrets',
    title: 'Sales Force Secrets',
    category: 'sales',
    level: 'intermediate',
    language: 'hindi',
    lessonCount: 11,
    durationMinutes: 1260,
    minTier: 'diamond',
    progress: 0,
    status: 'not_started',
    score: null,
    certificateUrl: null,
  },
  {
    id: id(16),
    slug: 'law-of-attraction',
    title: 'The Law of Attraction',
    category: 'mindset',
    level: 'beginner',
    language: 'hindi',
    lessonCount: 7,
    durationMinutes: 720,
    minTier: 'diamond',
    progress: 100,
    status: 'completed',
    score: 84,
    certificateUrl: '/certificates/law-of-attraction.pdf',
  },
  {
    id: id(17),
    slug: 'diamond-weekly-recordings',
    title: 'Diamond Weekly Session Recordings',
    category: 'sessions',
    level: 'all',
    language: 'hindi',
    lessonCount: 28,
    durationMinutes: 2460,
    minTier: 'diamond',
    progress: 21,
    status: 'ongoing',
    score: null,
    certificateUrl: null,
  },
];

export const workshops: Workshop[] = [
  {
    id: id(20),
    title: 'New Diamond Members Planning Call',
    startsAt: '2026-09-20T03:30:00.000Z',
    endsAt: '2026-09-20T08:30:00.000Z',
    platform: 'zoom_webinar',
    recurring: true,
    occurrence: { index: 50, total: 405 },
    registered: false,
    joinUrl: null,
  },
  {
    id: id(21),
    title: 'Laser-Targeted Marketing Ads with Aman Saifi',
    startsAt: '2026-09-21T06:30:00.000Z',
    endsAt: '2026-09-21T09:30:00.000Z',
    platform: 'zoom_webinar',
    recurring: false,
    occurrence: null,
    registered: true,
    joinUrl: 'https://zoom.example/ipc-laser-ads',
  },
  {
    id: id(22),
    title: 'Diamond Weekly Calls by Abdullah Ansari — Action Mode ON',
    startsAt: '2026-09-22T05:30:00.000Z',
    endsAt: '2026-09-22T10:30:00.000Z',
    platform: 'zoom_webinar',
    recurring: true,
    occurrence: { index: 70, total: 97 },
    registered: false,
    joinUrl: null,
  },
  {
    id: id(23),
    title: 'New Diamond Members Planning Call',
    startsAt: '2026-09-24T03:30:00.000Z',
    endsAt: '2026-09-24T08:30:00.000Z',
    platform: 'zoom_webinar',
    recurring: true,
    occurrence: { index: 51, total: 405 },
    registered: false,
    joinUrl: null,
  },
];

export const channels: Channel[] = [
  { id: id(30), slug: 'wins', name: 'Share your WINs', unread: 3 },
  { id: id(31), slug: 'announcements', name: 'Announcements', unread: 0 },
  { id: id(32), slug: 'ask-for-help', name: 'Ask for help', unread: 0 },
  { id: id(33), slug: 'introductions', name: 'Introductions', unread: 0 },
];

export const posts: Post[] = [
  {
    id: id(40),
    channelSlug: 'wins',
    author: { name: 'Rohit Bundela', initials: 'RB', tier: 'diamond' },
    bodyMd:
      'Closed my first ₹1.2L wedding package this week using the quotation format from the Library. Sent it the same evening as the enquiry — they signed in two days.',
    mediaCount: 2,
    likes: 186,
    likedByMe: false,
    comments: 31,
    createdAt: '2026-09-18T04:30:00.000Z',
    teamReply: null,
  },
  {
    id: id(41),
    channelSlug: 'ask-for-help',
    author: { name: 'Pranav Sahu', initials: 'PS', tier: 'diamond' },
    bodyMd:
      'Request to IPC — if a call is not happening, please send a notification. I waited 1:30 hours today for a session that had not started.',
    mediaCount: 0,
    likes: 42,
    likedByMe: false,
    comments: 9,
    createdAt: '2026-09-17T09:10:00.000Z',
    teamReply: 'Reminders now go out 15 minutes before every call.',
  },
];

export const libraryCategories: LibraryCategory[] = [
  { id: id(50), slug: 'business-docs', name: 'Business Docs', blurb: 'Quotation · T&Cs · Fees', itemCount: 24, unit: 'files' },
  { id: id(51), slug: 'templates', name: 'Templates', blurb: 'Ads · Followers · Campaigns', itemCount: 61, unit: 'files' },
  { id: id(52), slug: 'scripts', name: 'Scripts', blurb: 'Sales · Inquiry · Messaging', itemCount: 38, unit: 'files' },
  { id: id(53), slug: 'winning-ads', name: 'Winning Ads', blurb: 'High-performing creatives', itemCount: 112, unit: 'files' },
  { id: id(54), slug: 'quick-links', name: 'Quick Links', blurb: 'Sadhana · Meditation · Portfolio', itemCount: 19, unit: 'links' },
  { id: id(55), slug: 'photo-library', name: 'Photo Library', blurb: 'Curated images to use', itemCount: 340, unit: 'images' },
  { id: id(56), slug: 'training-videos', name: 'Training & Videos', blurb: 'Recordings · Courses · Tutorials', itemCount: 86, unit: 'videos' },
];

export const leaderboard: LeaderboardRow[] = [
  { rank: 1, name: 'Ashwin Patel', initials: 'AP', xp: 170000 },
  { rank: 2, name: 'Shivam Diwakar', initials: 'SD', xp: 160000 },
  { rank: 3, name: 'Nitin Patil', initials: 'NP', xp: 155000 },
  { rank: 4, name: 'Narendra Rana', initials: 'NR', xp: 154000 },
  { rank: 5, name: 'Mukund Solanki', initials: 'MS', xp: 132000 },
];

export const activity: ActivityDay[] = [
  { day: 'mon', courses: 186, workshops: 120, library: 72 },
  { day: 'tue', courses: 258, workshops: 96, library: 162 },
  { day: 'wed', courses: 138, workshops: 312, library: 210 },
  { day: 'thu', courses: 210, workshops: 162, library: 102 },
  { day: 'fri', courses: 282, workshops: 180, library: 120 },
  { day: 'sat', courses: 102, workshops: 138, library: 66 },
  { day: 'sun', courses: 78, workshops: 114, library: 54 },
];

export const performance: Performance = {
  totalScore: 80,
  breakdown: { participation: 55, quiz: 15, exam: 10 },
  trend: [
    { label: 'Mar', value: 42 },
    { label: 'Apr', value: 55 },
    { label: 'May', value: 49 },
    { label: 'Jun', value: 72 },
    { label: 'Jul', value: 63 },
    { label: 'Aug', value: 70 },
    { label: 'Sep', value: 78 },
  ],
};

export const dashboardStats: DashboardStats = {
  lessonsCompleted: 12,
  coursesInProgress: 2,
  minutesLearned: 486,
  streakDays: 4,
  longestStreakDays: 11,
  xp: 2450,
  rank: 18,
  workshopsAttended: 3,
  upcomingWorkshops: 3,
};

/* ── Lessons ───────────────────────────────────────────────────────────────
   Seed lessons so the player is exercisable without a database. The stream is
   the public hls.js test asset; a real deployment mints a signed URL per
   request from the video provider instead. */

export const DEMO_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

export type SeedLesson = {
  id: string;
  moduleId: string;
  moduleTitle: string;
  courseSlug: string;
  slug: string;
  title: string;
  durationSeconds: number;
  isPreview: boolean;
};

const lesson = (
  n: number,
  courseSlug: string,
  moduleTitle: string,
  slug: string,
  title: string,
  durationSeconds: number,
  isPreview = false,
): SeedLesson => ({
  id: id(600 + n),
  moduleId: id(500 + Math.floor(n / 10)),
  moduleTitle,
  courseSlug,
  slug,
  title,
  durationSeconds,
  isPreview,
});

export const lessons: SeedLesson[] = [
  lesson(1, 'diamond-crash-course-english', 'Getting started', 'welcome', 'Start here — how the Diamond year works', 492, true),
  lesson(2, 'diamond-crash-course-english', 'Getting started', 'set-up-your-week', 'Set up your week so the calls actually fit', 731),
  lesson(3, 'diamond-crash-course-english', 'Getting started', 'the-one-number', 'The one number to track this month', 545),
  lesson(11, 'diamond-crash-course-english', 'Positioning', 'why-positioning', 'Why positioning beats persuasion', 918),
  lesson(12, 'diamond-crash-course-english', 'Positioning', 'expensive-problem', 'Finding the expensive problem', 1240),
  lesson(13, 'diamond-crash-course-english', 'Positioning', 'three-sentence-offer', 'The three-sentence offer', 708),
  lesson(14, 'diamond-crash-course-english', 'Positioning', 'test-in-dms', 'Testing the promise in DMs', 545),
  lesson(21, 'diamond-crash-course-english', 'Pricing', 'package-not-hours', 'Package the outcome, not the hours', 662),
  lesson(22, 'diamond-crash-course-english', 'Pricing', 'quotation-that-closes', 'The quotation that closes itself', 803),

  lesson(31, 'photography-business-from-zero', 'Foundations', 'first-client', 'Your first paying client in 14 days', 640, true),
  lesson(32, 'photography-business-from-zero', 'Foundations', 'gear-you-need', 'The gear you actually need to start', 415),
  lesson(41, 'photography-business-from-zero', 'Getting booked', 'reels-that-book', 'Reels that book shoots, not likes', 702),

  lesson(51, 'mindset-mastery', 'Inner game', 'morning-routine', 'The morning routine that survives a shoot day', 388, true),
  lesson(52, 'mindset-mastery', 'Inner game', 'handling-rejection', 'Handling a no without losing the week', 521),
];

export const modulesFor = (courseSlug: string) => {
  const rows = lessons.filter((l) => l.courseSlug === courseSlug);
  const byModule = new Map<string, SeedLesson[]>();
  for (const l of rows) byModule.set(l.moduleTitle, [...(byModule.get(l.moduleTitle) ?? []), l]);
  return [...byModule.entries()];
};

/** In-memory progress, so Mark complete and resume work without a database. */
export const progress = new Map<string, { completed: boolean; positionSeconds: number }>();

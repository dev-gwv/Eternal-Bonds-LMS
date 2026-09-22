import { lazy } from 'react';
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppShell } from '../shared/layout/AppShell.tsx';
import { DashboardPage } from '../routes/Dashboard.tsx';

/**
 * Routes are declared with literal paths so TanStack can infer the route tree —
 * that inference is what makes every <Link to="…"> typo a compile error.
 *
 * Every section below the dashboard is React.lazy: Vite emits one chunk per
 * route file, and the shell suspends on navigation (see AppShell's Suspense
 * around <Outlet/>). The dashboard stays eager — it is the first paint.
 * This is the perf budget (docs/perf-budget.md) in practice.
 */

const lazyPage = <T extends object>(loader: () => Promise<T>, name: keyof T) =>
  lazy(() => loader().then((m) => ({ default: m[name] as unknown as React.ComponentType })));

const CommunityPage = lazyPage(() => import('../routes/Community.tsx'), 'CommunityPage');
const CourseResumePage = lazyPage(() => import('../routes/CourseResume.tsx'), 'CourseResumePage');
const CoursesPage = lazyPage(() => import('../routes/Courses.tsx'), 'CoursesPage');
const LessonPage = lazyPage(() => import('../routes/Lesson.tsx'), 'LessonPage');
const LibraryPage = lazyPage(() => import('../routes/Library.tsx'), 'LibraryPage');
const MemberPage = lazyPage(() => import('../routes/Member.tsx'), 'MemberPage');
const MembershipPage = lazyPage(() => import('../routes/Membership.tsx'), 'MembershipPage');
const NotificationsPage = lazyPage(() => import('../routes/Notifications.tsx'), 'NotificationsPage');
const ThinkTankPage = lazyPage(() => import('../routes/ThinkTank.tsx'), 'ThinkTankPage');
const ShareInsightPage = lazyPage(() => import('../routes/ThinkTank.tsx'), 'ShareInsightPage');
const WinsPage = lazyPage(() => import('../routes/Wins.tsx'), 'WinsPage');
const SubmitWinPage = lazyPage(() => import('../routes/Wins.tsx'), 'SubmitWinPage');
const EventsPage = lazyPage(() => import('../routes/Events.tsx'), 'EventsPage');
const WinDetailPage = lazyPage(() => import('../routes/Events.tsx'), 'WinDetailPage');
const InsightDetailPage = lazyPage(() => import('../routes/Events.tsx'), 'InsightDetailPage');
const DirectoryPage = lazyPage(() => import('../routes/Directory.tsx'), 'DirectoryPage');
const LegalPage = lazyPage(() => import('../routes/Legal.tsx'), 'LegalPage');
const ModerationPage = lazyPage(() => import('../routes/admin/Moderation.tsx'), 'ModerationPage');
const PhotolancerPage = lazyPage(() => import('../routes/Photolancer.tsx'), 'PhotolancerPage');
const WorkshopsPage = lazyPage(() => import('../routes/Workshops.tsx'), 'WorkshopsPage');
const AccountPage = lazyPage(() => import('../routes/Account.tsx'), 'AccountPage');
const CourseBuilderPage = lazyPage(() => import('../routes/admin/CourseBuilder.tsx'), 'CourseBuilderPage');
const StudioPage = lazyPage(() => import('../routes/admin/Studio.tsx'), 'StudioPage');
const MembersPage = lazyPage(() => import('../routes/admin/Members.tsx'), 'MembersPage');
const WelcomePage = lazyPage(() => import('../routes/Welcome.tsx'), 'WelcomePage');
const JourneysPage = lazyPage(() => import('../routes/Journeys.tsx'), 'JourneysPage');
const JourneyDetailPage = lazyPage(() => import('../routes/Journeys.tsx'), 'JourneyDetailPage');
const AdminJourneysPage = lazyPage(() => import('../routes/admin/Journeys.tsx'), 'AdminJourneysPage');
const AdminJourneyBuilderPage = lazyPage(() => import('../routes/admin/Journeys.tsx'), 'AdminJourneyBuilderPage');
const CohortsPage = lazyPage(() => import('../routes/admin/Cohorts.tsx'), 'CohortsPage');
const CohortDetailPage = lazyPage(() => import('../routes/admin/CohortDetail.tsx'), 'CohortDetailPage');
const MemberDetailPage = lazyPage(() => import('../routes/admin/MemberDetail.tsx'), 'MemberDetailPage');
const WorkshopStudioPage = lazyPage(() => import('../routes/admin/WorkshopStudio.tsx'), 'WorkshopStudioPage');

const rootRoute = createRootRoute({ component: AppShell });

const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage });
const communityRoute = createRoute({ getParentRoute: () => rootRoute, path: '/community', component: CommunityPage });
const workshopsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/workshops', component: WorkshopsPage });
const coursesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/courses', component: CoursesPage });
const courseResumeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/courses/$slug',
  component: CourseResumePage,
});
const lessonRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/learn/$courseSlug/$lessonSlug',
  component: LessonPage,
});
const libraryRoute = createRoute({ getParentRoute: () => rootRoute, path: '/library', component: LibraryPage });
const memberRoute = createRoute({ getParentRoute: () => rootRoute, path: '/members/me', component: MemberPage });
const accountRoute = createRoute({ getParentRoute: () => rootRoute, path: '/account', component: AccountPage });
const membershipRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/membership',
  component: MembershipPage,
});
const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notifications',
  component: NotificationsPage,
});
const photolancerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/photolancer',
  component: PhotolancerPage,
});
const thinkTankRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/think-tank',
  component: ThinkTankPage,
});
const shareInsightRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/think-tank/share',
  component: ShareInsightPage,
});
const insightDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/think-tank/$slug',
  component: InsightDetailPage,
});
const winsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/wins', component: WinsPage });
const submitWinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wins/submit',
  component: SubmitWinPage,
});
const winDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wins/$slug',
  component: WinDetailPage,
});
const eventsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/events', component: EventsPage });
const directoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/members',
  component: DirectoryPage,
});
const legalRoute = createRoute({ getParentRoute: () => rootRoute, path: '/legal', component: LegalPage });
const moderationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/moderation',
  component: ModerationPage,
});

/* The studio. Reachable only from the Studio link, which the shell shows only
   to admins — and every route under it calls an API that checks again. */
const studioRoute = createRoute({ getParentRoute: () => rootRoute, path: '/admin', component: StudioPage });
const membersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/members',
  component: MembersPage,
});
const memberDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/members/$id',
  component: MemberDetailPage,
});
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/welcome',
  component: WelcomePage,
});
const journeysRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/journeys',
  component: JourneysPage,
});
const journeyDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/journeys/$slug',
  component: JourneyDetailPage,
});
const adminJourneysRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/journeys',
  component: AdminJourneysPage,
});
const adminJourneyBuilderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/journeys/$slug',
  component: AdminJourneyBuilderPage,
});
const cohortsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/cohorts',
  component: CohortsPage,
});
const cohortDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/cohorts/$id',
  component: CohortDetailPage,
});
const courseBuilderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/courses/$id',
  component: CourseBuilderPage,
});
const workshopStudioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/workshops',
  component: WorkshopStudioPage,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  communityRoute,
  workshopsRoute,
  coursesRoute,
  courseResumeRoute,
  lessonRoute,
  libraryRoute,
  memberRoute,
  accountRoute,
  membershipRoute,
  notificationsRoute,
  photolancerRoute,
  thinkTankRoute,
  shareInsightRoute,
  insightDetailRoute,
  winsRoute,
  submitWinRoute,
  winDetailRoute,
  eventsRoute,
  directoryRoute,
  legalRoute,
  moderationRoute,
  studioRoute,
  membersRoute,
  memberDetailRoute,
  welcomeRoute,
  journeysRoute,
  journeyDetailRoute,
  adminJourneysRoute,
  adminJourneyBuilderRoute,
  cohortsRoute,
  cohortDetailRoute,
  courseBuilderRoute,
  workshopStudioRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

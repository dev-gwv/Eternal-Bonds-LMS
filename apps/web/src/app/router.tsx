import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppShell } from '../shared/layout/AppShell.tsx';
import { AccountPage } from '../routes/Account.tsx';
import { CommunityPage } from '../routes/Community.tsx';
import { CourseResumePage } from '../routes/CourseResume.tsx';
import { CoursesPage } from '../routes/Courses.tsx';
import { DashboardPage } from '../routes/Dashboard.tsx';
import { LessonPage } from '../routes/Lesson.tsx';
import { LibraryPage } from '../routes/Library.tsx';
import { MemberPage } from '../routes/Member.tsx';
import { MembershipPage } from '../routes/Membership.tsx';
import { NotificationsPage } from '../routes/Notifications.tsx';
import { PhotolancerPage } from '../routes/Photolancer.tsx';
import { WorkshopsPage } from '../routes/Workshops.tsx';
import { CourseBuilderPage } from '../routes/admin/CourseBuilder.tsx';
import { StudioPage } from '../routes/admin/Studio.tsx';
import { WorkshopStudioPage } from '../routes/admin/WorkshopStudio.tsx';

/**
 * Routes are declared with literal paths so TanStack can infer the route tree —
 * that inference is what makes every <Link to="…"> typo a compile error.
 */
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

/* The studio. Reachable only from the Studio link, which the shell shows only
   to admins — and every route under it calls an API that checks again. */
const studioRoute = createRoute({ getParentRoute: () => rootRoute, path: '/admin', component: StudioPage });
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
  studioRoute,
  courseBuilderRoute,
  workshopStudioRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

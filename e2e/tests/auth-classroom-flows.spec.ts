import type { Browser, BrowserContext } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import { ClassroomPage } from '../pages/classroom.page';
import {
  APP_BASE_URL,
  addSessionCookie,
  createAuthSession,
  createJoinToken,
  readPlatformStore,
  resetRaicData,
  writeClassroomData,
  writePlatformStore,
} from './support/ai-governance';

const CLASSROOM_COOKIE_NAME = 'raic_classroom_access';
const SESSION_COOKIE_NAME = 'raic_session';

test.describe.configure({ mode: 'serial' });
test.use({ locale: 'en-US' });

async function createAuthedPage(browser: Browser, token: string) {
  const context = await browser.newContext();
  await addSessionCookie(context, token);
  const page = await context.newPage();
  return { context, page };
}

async function getCookieValue(context: BrowserContext, name: string) {
  const cookies = await context.cookies(APP_BASE_URL);
  return cookies.find((cookie) => cookie.name === name)?.value ?? null;
}

function countClassroomSessions(store: Awaited<ReturnType<typeof readPlatformStore>>, classroomId: string) {
  return store.sessions.filter(
    (session) => session.kind === 'classroom' && session.classroomId === classroomId,
  ).length;
}

test.beforeEach(async () => {
  await resetRaicData();
});

test.afterAll(async () => {
  await resetRaicData();
});

test('protected routes redirect unauthenticated users and authenticated users skip sign-in', async ({
  page,
  browser,
}) => {
  let teacherContext: BrowserContext | undefined;

  try {
    await page.goto(`${APP_BASE_URL}/studio`);
    await page.waitForURL(/\/sign-in\?next=%2Fstudio$/);
    await expect(page.getByText('Teacher and admin sign-in')).toBeVisible();

    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-auth',
      email: 'teacher-auth@example.com',
      displayName: 'Teacher Auth',
      organizationId: 'org-auth',
      organizationName: 'Auth Academy',
      organizationSlug: 'auth-academy',
    });

    await writePlatformStore({
      sessions: [teacherSession],
    });

    const teacher = await createAuthedPage(browser, teacherSession.token);
    teacherContext = teacher.context;
    await teacher.page.goto(`${APP_BASE_URL}/sign-in`);
    await teacher.page.waitForURL(/\/studio$/);
    await expect(teacher.page.getByText('Teacher Studio')).toBeVisible();
  } finally {
    await teacherContext?.close();
  }
});

test('logout clears both web and classroom cookies', async ({ browser }) => {
  let teacherContext: BrowserContext | undefined;

  try {
    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-logout',
      email: 'teacher-logout@example.com',
      displayName: 'Teacher Logout',
      organizationId: 'org-logout',
      organizationName: 'Logout Academy',
      organizationSlug: 'logout-academy',
    });

    await writePlatformStore({
      sessions: [teacherSession],
    });

    const teacher = await createAuthedPage(browser, teacherSession.token);
    teacherContext = teacher.context;
    await teacher.context.addCookies([
      {
        name: CLASSROOM_COOKIE_NAME,
        value: 'classroom-cookie-to-clear',
        url: APP_BASE_URL,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    await teacher.page.goto(`${APP_BASE_URL}/studio`);
    const logoutResponse = await teacher.page.request.post(`${APP_BASE_URL}/api/auth/logout`);
    expect(logoutResponse.ok()).toBeTruthy();

    await expect
      .poll(async () => {
        const cookieNames = (await teacher.context.cookies(APP_BASE_URL)).map((cookie) => cookie.name);
        return {
          hasSessionCookie: cookieNames.includes(SESSION_COOKIE_NAME),
          hasClassroomCookie: cookieNames.includes(CLASSROOM_COOKIE_NAME),
        };
      })
      .toEqual({
        hasSessionCookie: false,
        hasClassroomCookie: false,
      });
  } finally {
    await teacherContext?.close();
  }
});

test('teacher classroom access and join links use reusable classroom sessions until expiry', async ({
  browser,
}) => {
  let teacherContext: BrowserContext | undefined;
  let studentContext: BrowserContext | undefined;
  let secondStudentContext: BrowserContext | undefined;

  try {
    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-classroom',
      email: 'teacher-classroom@example.com',
      displayName: 'Teacher Classroom',
      organizationId: 'org-classroom',
      organizationName: 'Classroom Academy',
      organizationSlug: 'classroom-academy',
    });
    const joinToken = createJoinToken({
      classroomId: 'classroom-reuse',
      createdByUserId: teacherSession.user.id,
      organizationId: teacherSession.organization.id,
      displayName: 'Physics Lab Group A',
      rawToken: 'reuse-token-demo',
    });

    await writePlatformStore({
      sessions: [teacherSession],
      joinTokens: [joinToken.record],
    });
    await writeClassroomData({
      classroomId: 'classroom-reuse',
      ownerUserId: teacherSession.user.id,
      organizationId: teacherSession.organization.id,
      stageName: 'Momentum Lab',
      sceneTitles: ['Lesson intro', 'Velocity demo'],
    });

    const teacher = await createAuthedPage(browser, teacherSession.token);
    teacherContext = teacher.context;
    const teacherClassroom = new ClassroomPage(teacher.page);
    await teacher.page.goto(`${APP_BASE_URL}/classroom/classroom-reuse`);
    await teacherClassroom.waitForLoaded();
    await expect(teacherClassroom.sidebarScenes).toHaveCount(2);
    await expect(teacherClassroom.getSceneTitle(0)).toContainText('Lesson intro');

    studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    const studentClassroom = new ClassroomPage(studentPage);
    await studentPage.goto(`${APP_BASE_URL}/join/${joinToken.rawToken}/enter`);
    await studentPage.waitForURL(/\/classroom\/classroom-reuse$/);
    await studentClassroom.waitForLoaded();
    await expect(studentClassroom.sidebarScenes).toHaveCount(2);

    const firstStudentCookie = await getCookieValue(studentContext, CLASSROOM_COOKIE_NAME);
    expect(firstStudentCookie).toBeTruthy();
    await expect
      .poll(async () => countClassroomSessions(await readPlatformStore(), 'classroom-reuse'))
      .toBe(1);

    await studentPage.goto(`${APP_BASE_URL}/join/${joinToken.rawToken}/enter`);
    await studentPage.waitForURL(/\/classroom\/classroom-reuse$/);
    await studentClassroom.waitForLoaded();

    const reusedCookie = await getCookieValue(studentContext, CLASSROOM_COOKIE_NAME);
    expect(reusedCookie).toBe(firstStudentCookie);
    expect(countClassroomSessions(await readPlatformStore(), 'classroom-reuse')).toBe(1);

    secondStudentContext = await browser.newContext();
    const secondStudentPage = await secondStudentContext.newPage();
    const secondStudentClassroom = new ClassroomPage(secondStudentPage);
    await secondStudentPage.goto(`${APP_BASE_URL}/join/${joinToken.rawToken}/enter`);
    await secondStudentPage.waitForURL(/\/classroom\/classroom-reuse$/);
    await secondStudentClassroom.waitForLoaded();

    const secondStudentCookie = await getCookieValue(secondStudentContext, CLASSROOM_COOKIE_NAME);
    expect(secondStudentCookie).toBeTruthy();
    expect(secondStudentCookie).not.toBe(firstStudentCookie);
    await expect
      .poll(async () => countClassroomSessions(await readPlatformStore(), 'classroom-reuse'))
      .toBe(2);
  } finally {
    await teacherContext?.close();
    await studentContext?.close();
    await secondStudentContext?.close();
  }
});

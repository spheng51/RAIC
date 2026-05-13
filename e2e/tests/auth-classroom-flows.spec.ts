import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import { ClassroomPage } from '../pages/classroom.page';
import { createSettingsStorage } from '../fixtures/test-data/settings';
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
const ACCESS_CODE_COOKIE_NAME = 'openraic_access';
const LEGACY_ACCESS_CODE_COOKIE_NAME = ['open', 'maic_access'].join('');
const SESSION_COOKIE_NAME = 'raic_session';

test.describe.configure({ mode: 'serial' });
test.use({ locale: 'en-US' });

async function createAuthedPage(browser: Browser, token: string) {
  const context = await browser.newContext();
  await addSessionCookie(context, token);
  const page = await context.newPage();
  return { context, page };
}

async function closeContextIfOpen(context: BrowserContext | undefined) {
  if (!context) return;

  try {
    await context.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('Target.disposeBrowserContext') ||
      message.includes('Failed to find context') ||
      message.includes('has been closed')
    ) {
      return;
    }
    throw error;
  }
}

async function getCookieValue(context: BrowserContext, name: string) {
  const cookies = await context.cookies(APP_BASE_URL);
  return cookies.find((cookie) => cookie.name === name)?.value ?? null;
}

async function createJoinLinkFromOpenShareDialog(page: Page) {
  const joinTokenResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/classroom/join-token') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create link' }).click();
  const joinTokenResponse = await joinTokenResponsePromise;
  expect(joinTokenResponse.ok()).toBeTruthy();
  const joinTokenBody = (await joinTokenResponse.json()) as { joinUrl?: string };
  expect(joinTokenBody.joinUrl).toContain('/join/');
  await expect(page.getByText(joinTokenBody.joinUrl!)).toBeVisible();
  return joinTokenBody.joinUrl!;
}

async function enterClassroomFromJoinUrl(browser: Browser, joinUrl: string, classroomId: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const classroom = new ClassroomPage(page);

  await page.goto(joinUrl);
  const displayNameInput = page.getByRole('textbox', { name: 'Your display name' });
  if ((await displayNameInput.count()) > 0) {
    await expect(displayNameInput).toBeVisible();
    await displayNameInput.fill('Student Share');
    await page.getByRole('button', { name: 'Enter classroom' }).click();
  } else {
    await expect(page.getByRole('link', { name: 'Enter classroom' })).toBeVisible();
    await page.getByRole('link', { name: 'Enter classroom' }).click();
  }
  await page.waitForURL(new RegExp(`/classroom/${classroomId}$`));
  await classroom.waitForLoaded();

  return { context, page, classroom };
}

async function seedLocalClassroom(page: Page, classroomId: string) {
  await page.goto(`${APP_BASE_URL}/`);
  await expect(
    page.getByRole('heading', { name: 'Responsive Assistance Interactive Classroom' }),
  ).toBeVisible();

  await page.evaluate(
    async ({ classroomId: seededClassroomId }) => {
      function ensureStores(db: IDBDatabase) {
        const createStore = (
          name: string,
          options: IDBObjectStoreParameters,
        ): IDBObjectStore | null => {
          if (db.objectStoreNames.contains(name)) return null;
          return db.createObjectStore(name, options);
        };

        const stages = createStore('stages', { keyPath: 'id' });
        stages?.createIndex('updatedAt', 'updatedAt');

        const scenes = createStore('scenes', { keyPath: 'id' });
        scenes?.createIndex('stageId', 'stageId');
        scenes?.createIndex('order', 'order');
        scenes?.createIndex('[stageId+order]', ['stageId', 'order']);

        const audioFiles = createStore('audioFiles', { keyPath: 'id' });
        audioFiles?.createIndex('createdAt', 'createdAt');

        const imageFiles = createStore('imageFiles', { keyPath: 'id' });
        imageFiles?.createIndex('createdAt', 'createdAt');

        createStore('snapshots', { keyPath: 'id', autoIncrement: true });

        const chatSessions = createStore('chatSessions', { keyPath: 'id' });
        chatSessions?.createIndex('stageId', 'stageId');
        chatSessions?.createIndex('[stageId+createdAt]', ['stageId', 'createdAt']);

        createStore('playbackState', { keyPath: 'stageId' });
        createStore('stageOutlines', { keyPath: 'stageId' });

        const mediaFiles = createStore('mediaFiles', { keyPath: 'id' });
        mediaFiles?.createIndex('stageId', 'stageId');
        mediaFiles?.createIndex('[stageId+type]', ['stageId', 'type']);

        const generatedAgents = createStore('generatedAgents', { keyPath: 'id' });
        generatedAgents?.createIndex('stageId', 'stageId');
      }

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('RAIC-Database');
        request.onupgradeneeded = () => ensureStores(request.result);
        request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
        request.onsuccess = () => resolve(request.result);
      });

      const now = Date.now();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['stages', 'scenes', 'mediaFiles', 'audioFiles'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to seed local classroom'));

        tx.objectStore('stages').put({
          id: seededClassroomId,
          name: 'Local Share Lab',
          description: 'Local classroom that will become shareable',
          createdAt: now,
          updatedAt: now,
          language: 'en-US',
          style: 'professional',
        });
        tx.objectStore('scenes').put({
          id: `${seededClassroomId}-scene-1`,
          stageId: seededClassroomId,
          type: 'slide',
          title: 'Local intro',
          order: 0,
          content: {
            type: 'slide',
            canvas: {
              id: `${seededClassroomId}-slide-1`,
              viewportSize: 1000,
              viewportRatio: 0.5625,
              theme: {
                backgroundColor: '#ffffff',
                themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4'],
                fontColor: '#333333',
                fontName: 'Inter',
              },
              elements: [
                {
                  type: 'text',
                  id: 'local-title',
                  content: 'Local intro',
                  left: 50,
                  top: 50,
                  width: 900,
                  height: 100,
                },
                {
                  type: 'image',
                  id: 'local-image',
                  src: 'gen_img_local',
                  left: 80,
                  top: 180,
                  width: 320,
                  height: 180,
                },
              ],
            },
          },
          actions: [
            {
              id: 'speech-local-1',
              type: 'speech',
              text: 'Welcome to the local share lab.',
              audioId: 'tts-local-1',
            },
          ],
          createdAt: now,
          updatedAt: now,
        });
        tx.objectStore('mediaFiles').put({
          id: `${seededClassroomId}:gen_img_local`,
          stageId: seededClassroomId,
          type: 'image',
          blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
          mimeType: 'image/png',
          size: 4,
          prompt: 'A simple local demo image',
          params: '{}',
          createdAt: now,
        });
        tx.objectStore('audioFiles').put({
          id: 'tts-local-1',
          blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' }),
          format: 'mpeg',
          text: 'Welcome to the local share lab.',
          createdAt: now,
        });
      });
      db.close();

      sessionStorage.setItem(
        'classroomLaunchContext',
        JSON.stringify({
          classroomId: seededClassroomId,
          launchMode: 'public-demo',
          homePath: '/',
        }),
      );
    },
    { classroomId },
  );
}

function countClassroomSessions(
  store: Awaited<ReturnType<typeof readPlatformStore>>,
  classroomId: string,
) {
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

test('fresh access-code login writes the renamed access cookie', async ({ page }) => {
  test.skip(!process.env.ACCESS_CODE, 'Set ACCESS_CODE to enable access-code browser coverage.');

  await page.goto(`${APP_BASE_URL}/`);
  await expect(page.getByRole('heading', { name: 'Enter access code' })).toBeVisible();

  await page.getByPlaceholder('Access code').fill(process.env.ACCESS_CODE!);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Enter access code' })).toBeHidden();
  await expect
    .poll(async () => {
      const cookies = await page.context().cookies(APP_BASE_URL);
      return {
        hasNewCookie: cookies.some(
          (cookie) => cookie.name === ACCESS_CODE_COOKIE_NAME && cookie.value.length > 0,
        ),
        hasOldCookie: cookies.some((cookie) => cookie.name === LEGACY_ACCESS_CODE_COOKIE_NAME),
      };
    })
    .toEqual({
      hasNewCookie: true,
      hasOldCookie: false,
    });
});

test('protected routes redirect unauthenticated users and authenticated users skip sign-in', async ({
  page,
  browser,
}) => {
  let teacherContext: BrowserContext | undefined;

  try {
    await page.goto(`${APP_BASE_URL}/studio`);
    await page.waitForURL(/\/sign-in\?next=%2Fstudio$/);
    await expect(page.getByText('Teacher sign-in')).toBeVisible();

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
    await closeContextIfOpen(teacherContext);
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
        const cookieNames = (await teacher.context.cookies(APP_BASE_URL)).map(
          (cookie) => cookie.name,
        );
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
    await closeContextIfOpen(teacherContext);
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
    await closeContextIfOpen(teacherContext);
    await closeContextIfOpen(studentContext);
    await closeContextIfOpen(secondStudentContext);
  }
});

test('teacher shares from a Studio classroom card and a student enters through the join URL', async ({
  browser,
}) => {
  let teacherContext: BrowserContext | undefined;
  let studentContext: BrowserContext | undefined;

  const classroomId = 'classroom-studio-share';

  try {
    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-studio-share',
      email: 'teacher-studio-share@example.com',
      displayName: 'Teacher Studio Share',
      organizationId: 'org-studio-share',
      organizationName: 'Studio Share Academy',
      organizationSlug: 'studio-share-academy',
    });

    await writePlatformStore({
      sessions: [teacherSession],
    });
    await writeClassroomData({
      classroomId,
      ownerUserId: teacherSession.user.id,
      organizationId: teacherSession.organization.id,
      stageName: 'Studio Share Lab',
      sceneTitles: ['Studio share intro', 'Student activity'],
    });

    const teacher = await createAuthedPage(browser, teacherSession.token);
    teacherContext = teacher.context;
    await teacher.page.goto(`${APP_BASE_URL}/studio`);
    await expect(teacher.page.getByText('Teacher Studio', { exact: true })).toBeVisible();
    await expect(teacher.page.getByText('Studio Share Lab')).toBeVisible();

    const classroomCard = teacher.page.getByRole('button', {
      name: 'Open classroom Studio Share Lab',
    });
    await classroomCard.hover();
    await classroomCard.getByRole('button', { name: 'Share classroom' }).click();
    await expect(teacher.page.getByRole('heading', { name: 'Share classroom' })).toBeVisible();

    const joinUrl = await createJoinLinkFromOpenShareDialog(teacher.page);
    const student = await enterClassroomFromJoinUrl(browser, joinUrl, classroomId);
    studentContext = student.context;
    await expect(student.classroom.sidebarScenes).toHaveCount(2);
    await expect(student.classroom.getSceneTitle(0)).toContainText('Studio share intro');
  } finally {
    await closeContextIfOpen(teacherContext);
    await closeContextIfOpen(studentContext);
  }
});

test('teacher shares from the classroom header and a student enters through the join URL', async ({
  browser,
}) => {
  let teacherContext: BrowserContext | undefined;
  let studentContext: BrowserContext | undefined;

  const classroomId = 'classroom-header-share';

  try {
    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-header-share',
      email: 'teacher-header-share@example.com',
      displayName: 'Teacher Header Share',
      organizationId: 'org-header-share',
      organizationName: 'Header Share Academy',
      organizationSlug: 'header-share-academy',
    });

    await writePlatformStore({
      sessions: [teacherSession],
    });
    await writeClassroomData({
      classroomId,
      ownerUserId: teacherSession.user.id,
      organizationId: teacherSession.organization.id,
      stageName: 'Header Share Lab',
      sceneTitles: ['Header share intro', 'Exit ticket'],
    });

    const teacher = await createAuthedPage(browser, teacherSession.token);
    teacherContext = teacher.context;
    const teacherClassroom = new ClassroomPage(teacher.page);
    await teacher.page.goto(`${APP_BASE_URL}/classroom/${classroomId}`);
    await teacherClassroom.waitForLoaded();

    await teacher.page.getByRole('button', { name: 'Share classroom' }).click();
    await expect(teacher.page.getByRole('heading', { name: 'Share classroom' })).toBeVisible();

    const joinUrl = await createJoinLinkFromOpenShareDialog(teacher.page);
    const student = await enterClassroomFromJoinUrl(browser, joinUrl, classroomId);
    studentContext = student.context;
    await expect(student.classroom.sidebarScenes).toHaveCount(2);
    await expect(student.classroom.getSceneTitle(1)).toContainText('Exit ticket');
  } finally {
    await closeContextIfOpen(teacherContext);
    await closeContextIfOpen(studentContext);
  }
});

test('local demo Make shareable resumes after sign-in and opens the share dialog', async ({
  browser,
}) => {
  let teacherContext: BrowserContext | undefined;
  let studentContext: BrowserContext | undefined;

  const localClassroomId = 'local-shareable-e2e';

  try {
    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-local-publish',
      email: 'teacher-local-publish@example.com',
      displayName: 'Teacher Local Publish',
      organizationId: 'org-local-publish',
      organizationName: 'Local Publish Academy',
      organizationSlug: 'local-publish-academy',
    });

    await writePlatformStore({
      sessions: [teacherSession],
    });

    teacherContext = await browser.newContext();
    const teacherPage = await teacherContext.newPage();
    await seedLocalClassroom(teacherPage, localClassroomId);
    const localClassroom = new ClassroomPage(teacherPage);
    await teacherPage.goto(`${APP_BASE_URL}/classroom/${localClassroomId}`);
    await localClassroom.waitForLoaded();
    await expect(teacherPage.getByRole('button', { name: 'Make shareable' })).toBeVisible();

    await teacherPage.getByRole('button', { name: 'Make shareable' }).click();
    await teacherPage.waitForURL(
      new RegExp(`/sign-in\\?next=${encodeURIComponent(`/classroom/${localClassroomId}`)}$`),
    );
    await expect(teacherPage.getByText('Teacher sign-in')).toBeVisible();

    await addSessionCookie(teacherContext, teacherSession.token);
    await expect
      .poll(async () => getCookieValue(teacherContext!, SESSION_COOKIE_NAME))
      .toBe(teacherSession.token);
    const publishResponsePromise = teacherPage.waitForResponse(
      (response) =>
        response.url().endsWith('/api/classroom/publish-local') &&
        response.request().method() === 'POST',
    );
    await teacherPage.goto(
      `${APP_BASE_URL}/sign-in?next=${encodeURIComponent(`/classroom/${localClassroomId}`)}`,
    );
    const publishResponse = await publishResponsePromise;
    const publishBody = (await publishResponse.json()) as { id?: string; url?: string };
    expect(
      publishResponse.ok(),
      JSON.stringify({ status: publishResponse.status(), body: publishBody }),
    ).toBeTruthy();
    expect(publishBody.id).toBeTruthy();
    await teacherPage.waitForURL(new RegExp(`/classroom/${publishBody.id}(?:\\?share=1)?$`));
    await localClassroom.waitForLoaded();
    await expect(teacherPage.getByRole('heading', { name: 'Share classroom' })).toBeVisible();

    const publishedClassroomResponse = await teacherPage.request.get(
      `${APP_BASE_URL}/api/classroom?id=${encodeURIComponent(publishBody.id!)}`,
    );
    expect(publishedClassroomResponse.ok()).toBeTruthy();
    const publishedClassroomBody = (await publishedClassroomResponse.json()) as {
      classroom?: {
        scenes?: Array<{
          content?: { canvas?: { elements?: Array<{ src?: string }> } };
          actions?: Array<{ audioUrl?: string }>;
        }>;
      };
    };
    const publishedScene = publishedClassroomBody.classroom?.scenes?.[0];
    expect(
      publishedScene?.content?.canvas?.elements?.some((element) =>
        element.src?.includes(`/api/classroom-media/${publishBody.id}/media/gen_img_local.png`),
      ),
    ).toBe(true);
    expect(
      publishedScene?.actions?.some((action) =>
        action.audioUrl?.includes(`/api/classroom-media/${publishBody.id}/audio/tts-local-1.mp3`),
      ),
    ).toBe(true);

    const joinUrl = await createJoinLinkFromOpenShareDialog(teacherPage);
    const student = await enterClassroomFromJoinUrl(browser, joinUrl, publishBody.id!);
    studentContext = student.context;
    await expect(student.classroom.getSceneTitle(0)).toContainText('Local intro');
  } finally {
    await closeContextIfOpen(teacherContext);
    await closeContextIfOpen(studentContext);
  }
});

test('local public-demo classroom chat sends public-demo source and avoids classroom lookup errors', async ({
  browser,
}) => {
  let context: BrowserContext | undefined;
  const localClassroomId = 'local-chat-e2e';

  try {
    context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(
      (settings) => {
        localStorage.setItem('settings-storage', settings);
      },
      createSettingsStorage({ asrEnabled: false }),
    );

    await seedLocalClassroom(page, localClassroomId);

    const classroom = new ClassroomPage(page);
    await page.goto(`${APP_BASE_URL}/classroom/${localClassroomId}`);
    await classroom.waitForLoaded();

    const chatRequestPromise = page.waitForRequest(
      (request) => request.url().endsWith('/api/chat') && request.method() === 'POST',
    );
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: [
          `data: ${JSON.stringify({
            type: 'agent_start',
            data: {
              messageId: 'assistant-public-demo-chat',
              agentId: 'default-1',
              agentName: 'Teacher',
            },
          })}`,
          `data: ${JSON.stringify({
            type: 'text_delta',
            data: {
              messageId: 'assistant-public-demo-chat',
              content: 'Here is one short question.',
            },
          })}`,
          `data: ${JSON.stringify({
            type: 'agent_end',
            data: { messageId: 'assistant-public-demo-chat', agentId: 'default-1' },
          })}`,
          `data: ${JSON.stringify({
            type: 'done',
            data: {
              totalActions: 0,
              totalAgents: 1,
              agentHadContent: true,
            },
          })}`,
          '',
        ].join('\n\n'),
      });
    });

    await page.keyboard.press('t');
    await page.getByRole('button', { name: 'Quiz me' }).click();

    const chatRequest = await chatRequestPromise;
    const chatBody = chatRequest.postDataJSON() as {
      classroomSource?: string;
      storeState?: { stage?: { id?: string } | null };
      messages?: Array<{ parts?: Array<{ text?: string }> }>;
    };

    expect(chatBody.classroomSource).toBe('public-demo');
    expect(chatBody.storeState?.stage?.id).toBe(localClassroomId);
    expect(JSON.stringify(chatBody.messages)).toContain('Quiz me with one short question.');
    await expect(page.getByText('Here is one short question.')).toBeVisible();
    await expect(page.getByText('Classroom not found')).toHaveCount(0);
  } finally {
    await closeContextIfOpen(context);
  }
});

test('teacher shares a classroom invite with an attached Zoom join link', async ({ browser }) => {
  let teacherContext: BrowserContext | undefined;
  let studentContext: BrowserContext | undefined;

  const classroomId = 'classroom-zoom-share';
  const zoomJoinUrl = 'https://zoom.us/j/123456789?pwd=phase1';

  try {
    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-zoom',
      email: 'teacher-zoom@example.com',
      displayName: 'Teacher Zoom',
      organizationId: 'org-zoom',
      organizationName: 'Zoom Academy',
      organizationSlug: 'zoom-academy',
    });

    await writePlatformStore({
      sessions: [teacherSession],
    });
    await writeClassroomData({
      classroomId,
      ownerUserId: teacherSession.user.id,
      organizationId: teacherSession.organization.id,
      stageName: 'Live Discussion Lab',
      sceneTitles: ['Invite setup', 'Live discussion'],
    });

    const teacher = await createAuthedPage(browser, teacherSession.token);
    teacherContext = teacher.context;
    const teacherClassroom = new ClassroomPage(teacher.page);
    await teacher.page.goto(`${APP_BASE_URL}/classroom/${classroomId}`);
    await teacherClassroom.waitForLoaded();

    const zoomLoadResponsePromise = teacher.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/classroom/${classroomId}/live-meeting`) &&
        response.request().method() === 'GET',
    );
    await teacher.page.getByRole('button', { name: 'Share classroom' }).click();
    await expect(teacher.page.getByRole('heading', { name: 'Share classroom' })).toBeVisible();
    await zoomLoadResponsePromise;
    await expect(teacher.page.getByLabel('Zoom join link')).toBeEnabled();

    await teacher.page.getByLabel('Zoom join link').fill('https://zoom.us/profile');
    const invalidZoomResponsePromise = teacher.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/classroom/${classroomId}/live-meeting`) &&
        response.request().method() === 'PUT',
    );
    await teacher.page.getByRole('button', { name: 'Save Zoom link' }).click();
    const invalidZoomResponse = await invalidZoomResponsePromise;
    expect(invalidZoomResponse.status()).toBe(400);
    await expect(
      teacher.page.getByText(
        'Use an attendee Zoom invite link in the format https://zoom.us/j/{meetingId}.',
      ),
    ).toBeVisible();

    await teacher.page.getByLabel('Zoom join link').fill(zoomJoinUrl);
    await teacher.page.getByLabel('Room label').fill('Live discussion room');

    const saveZoomResponsePromise = teacher.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/classroom/${classroomId}/live-meeting`) &&
        response.request().method() === 'PUT',
    );
    await teacher.page.getByRole('button', { name: 'Save Zoom link' }).click();
    const saveZoomResponse = await saveZoomResponsePromise;
    expect(saveZoomResponse.ok()).toBeTruthy();
    await expect(teacher.page.getByText(`Attached Zoom link: ${zoomJoinUrl}`)).toBeVisible();

    const joinTokenResponsePromise = teacher.page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/classroom/join-token') &&
        response.request().method() === 'POST',
    );
    await teacher.page.getByRole('button', { name: 'Create link' }).click();
    const joinTokenResponse = await joinTokenResponsePromise;
    expect(joinTokenResponse.ok()).toBeTruthy();
    const joinTokenBody = (await joinTokenResponse.json()) as { joinUrl?: string };
    expect(joinTokenBody.joinUrl).toContain('/join/');
    await expect(teacher.page.getByText(joinTokenBody.joinUrl!)).toBeVisible();

    await teacher.page.getByRole('button', { name: 'Close' }).first().click();
    const headerZoomLink = teacher.page.locator('header').getByRole('link', { name: 'Join Zoom' });
    await expect(headerZoomLink).toHaveAttribute('href', zoomJoinUrl);

    const joinCode = new URL(joinTokenBody.joinUrl!).pathname.split('/').filter(Boolean).pop();
    expect(joinCode).toBeTruthy();
    studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(`${APP_BASE_URL}/join/${joinCode}`);

    await expect(studentPage.getByText('Live Discussion Lab')).toBeVisible();
    await expect(studentPage.getByText('Live discussion room')).toBeVisible();
    await expect(studentPage.getByRole('link', { name: 'Join Zoom' })).toHaveAttribute(
      'href',
      zoomJoinUrl,
    );
    await expect(studentPage.getByRole('link', { name: 'Enter classroom' })).toBeVisible();

    await teacher.page.getByRole('button', { name: 'Share classroom' }).click();
    const removeZoomResponsePromise = teacher.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/classroom/${classroomId}/live-meeting`) &&
        response.request().method() === 'DELETE',
    );
    await teacher.page.getByRole('button', { name: 'Remove' }).click();
    const removeZoomResponse = await removeZoomResponsePromise;
    expect(removeZoomResponse.ok()).toBeTruthy();
    await teacher.page.getByRole('button', { name: 'Close' }).first().click();
    await expect(headerZoomLink).toHaveCount(0);
  } finally {
    await closeContextIfOpen(teacherContext);
    await closeContextIfOpen(studentContext);
  }
});

test('teacher schedules a linked class from the studio and opens its classroom', async ({
  browser,
}) => {
  test.setTimeout(60_000);

  let teacherContext: BrowserContext | undefined;

  try {
    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-schedule',
      email: 'teacher-schedule@example.com',
      displayName: 'Teacher Schedule',
      organizationId: 'org-schedule',
      organizationName: 'Schedule Academy',
      organizationSlug: 'schedule-academy',
    });

    await writePlatformStore({
      sessions: [teacherSession],
    });
    await writeClassroomData({
      classroomId: 'classroom-scheduled',
      ownerUserId: teacherSession.user.id,
      organizationId: teacherSession.organization.id,
      stageName: 'Scheduled Room',
      sceneTitles: ['Schedule intro'],
    });

    const teacher = await createAuthedPage(browser, teacherSession.token);
    teacherContext = teacher.context;
    await teacher.page.goto(`${APP_BASE_URL}/studio`);

    const schedule = teacher.page.getByTestId('schedule-classes-box');
    await expect(schedule).toBeVisible();
    await schedule.getByRole('button', { name: 'Add' }).click();
    await teacher.page.getByLabel('Class title').fill('Teacher linked class');

    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(14, 0, 0, 0);
    await teacher.page
      .getByLabel('Date')
      .fill(
        `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(
          start.getDate(),
        ).padStart(2, '0')}`,
      );
    await teacher.page.getByLabel('Time').fill('14:00');
    await teacher.page.getByText('No classroom').click();
    await teacher.page.getByRole('option', { name: 'Scheduled Room' }).click();
    await Promise.all([
      teacher.page.waitForURL(/\/classroom\/classroom-scheduled$/),
      teacher.page.getByRole('button', { name: 'Create' }).click(),
    ]);
    const teacherClassroom = new ClassroomPage(teacher.page);
    await teacherClassroom.waitForLoaded();
  } finally {
    await closeContextIfOpen(teacherContext);
  }
});

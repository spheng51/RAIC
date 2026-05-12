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
  startMockMiroFishServer,
  writeClassroomData,
  writePlatformStore,
} from './support/ai-governance';
import type { SharedSimulation } from '../../lib/types/stage';

test.describe.configure({ mode: 'serial' });
test.use({ locale: 'en-US' });

let mockMiroFish: Awaited<ReturnType<typeof startMockMiroFishServer>> | undefined;

async function createAuthedClassroomPage(browser: Browser, token: string, classroomId: string) {
  const context = await browser.newContext();
  await addSessionCookie(context, token);
  const page = await context.newPage();
  const classroom = new ClassroomPage(page);
  await page.goto(`${APP_BASE_URL}/classroom/${classroomId}`);
  await classroom.waitForLoaded();
  return { context, page, classroom };
}

async function joinClassroom(browser: Browser, rawJoinToken: string, classroomId: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const classroom = new ClassroomPage(page);
  await page.goto(`${APP_BASE_URL}/join/${rawJoinToken}/enter`);
  await page.waitForURL(new RegExp(`/classroom/${classroomId}$`));
  await classroom.waitForLoaded();
  await waitForClassroomAccessCookie(context);
  return { context, page, classroom };
}

async function getCookieValue(context: BrowserContext, name: string) {
  const cookies = await context.cookies(APP_BASE_URL);
  return cookies.find((cookie) => cookie.name === name)?.value ?? null;
}

async function waitForClassroomAccessCookie(context: BrowserContext) {
  await expect
    .poll(() => getCookieValue(context, 'raic_classroom_access'), { timeout: 15_000 })
    .toBeTruthy();
}

async function expectMiroFishFrameSrc(classroom: ClassroomPage, pattern: RegExp, timeout = 15_000) {
  try {
    await expect
      .poll(async () => (await classroom.miroFishFrame.getAttribute('src')) ?? '', { timeout })
      .toMatch(pattern);
    return;
  } catch {
    await classroom.page.reload();
    await classroom.waitForLoaded();
  }

  await expect
    .poll(async () => (await classroom.miroFishFrame.getAttribute('src')) ?? '', { timeout })
    .toMatch(pattern);
}

function countClassroomSessions(
  store: Awaited<ReturnType<typeof readPlatformStore>>,
  classroomId: string,
) {
  return store.sessions.filter(
    (session) => session.kind === 'classroom' && session.classroomId === classroomId,
  ).length;
}

async function countPersistedClassroomSessions(classroomId: string) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return countClassroomSessions(await readPlatformStore(), classroomId);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return 0;
      }
      if ((code === 'EPERM' || code === 'EBUSY') && attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 50));
        continue;
      }
      throw error;
    }
  }

  return 0;
}

function createAttachedSimulation(
  baseUrl: string,
  overrides: Partial<SharedSimulation> & Pick<SharedSimulation, 'simulationId'>,
): SharedSimulation {
  const collaborationMode = overrides.collaborationMode ?? 'single-controller';
  const reportId = overrides.reportId;

  return {
    provider: 'mirofish',
    simulationId: overrides.simulationId,
    reportId,
    runUrl:
      overrides.runUrl ??
      `${baseUrl}/simulation/${encodeURIComponent(overrides.simulationId)}/start?embed=1`,
    reportUrl:
      reportId && !overrides.reportUrl
        ? `${baseUrl}/report/${encodeURIComponent(reportId)}?embed=1`
        : overrides.reportUrl,
    activeSurface: overrides.activeSurface ?? 'lesson',
    controllerSessionId: overrides.controllerSessionId,
    controllerRole: overrides.controllerRole ?? 'teacher',
    controlLeaseExpiresAt: overrides.controlLeaseExpiresAt,
    collaborationMode,
    mirofishSessionId: overrides.mirofishSessionId,
    collaborationState: overrides.collaborationState ?? 'inactive',
    allowStudentInteraction:
      overrides.allowStudentInteraction ?? collaborationMode === 'multi-user',
    spotlightSessionId: overrides.spotlightSessionId,
    participantCount: overrides.participantCount ?? 0,
    lastCollaborationSyncAt: overrides.lastCollaborationSyncAt ?? new Date().toISOString(),
    removedParticipantSessionIds: overrides.removedParticipantSessionIds,
    status: overrides.status ?? 'attached',
  };
}

test.beforeAll(async () => {
  mockMiroFish = await startMockMiroFishServer();
});

test.beforeEach(async () => {
  await resetRaicData();
});

test.afterAll(async () => {
  await mockMiroFish?.close();
  await resetRaicData();
});

test('single-controller classrooms switch surfaces and reclaim student control', async ({
  browser,
}) => {
  const teacherSession = createAuthSession({
    role: 'teacher',
    userId: 'teacher-mirofish-single',
    email: 'teacher-mirofish-single@example.com',
    displayName: 'Teacher MiroFish',
    organizationId: 'org-mirofish-single',
    organizationName: 'MiroFish Academy',
    organizationSlug: 'mirofish-academy',
  });
  const joinToken = createJoinToken({
    classroomId: 'mirofish-single-room',
    createdByUserId: teacherSession.user.id,
    organizationId: teacherSession.organization.id,
    displayName: 'Student One',
    rawToken: 'mirofish-single-student',
  });

  await writePlatformStore({
    sessions: [teacherSession],
    joinTokens: [joinToken.record],
  });
  await writeClassroomData({
    classroomId: 'mirofish-single-room',
    ownerUserId: teacherSession.user.id,
    organizationId: teacherSession.organization.id,
    stageName: 'Shared Reef Lab',
    sceneTitles: ['Coral intro', 'Predator pulse'],
    sharedSimulation: createAttachedSimulation(mockMiroFish!.baseUrl, {
      simulationId: 'reef-lab',
      reportId: 'reef-report',
      activeSurface: 'lesson',
      collaborationMode: 'single-controller',
      collaborationState: 'inactive',
      allowStudentInteraction: false,
      status: 'attached',
    }),
  });

  let teacherContext: BrowserContext | undefined;
  let studentContext: BrowserContext | undefined;

  try {
    const teacher = await createAuthedClassroomPage(
      browser,
      teacherSession.token,
      'mirofish-single-room',
    );
    teacherContext = teacher.context;

    const student = await joinClassroom(browser, joinToken.rawToken, 'mirofish-single-room');
    studentContext = student.context;

    await expect(teacher.page.getByText('1 students')).toBeVisible({ timeout: 30_000 });

    await teacher.classroom.switchSurface('Simulation');
    await expectMiroFishFrameSrc(teacher.classroom, /\/simulation\/reef-lab\/start/);
    await expectMiroFishFrameSrc(student.classroom, /\/simulation\/reef-lab\/start/);
    await expect(student.classroom.readOnlyOverlayHeading).toBeVisible();

    await teacher.classroom.switchSurface('Report');
    await expectMiroFishFrameSrc(teacher.classroom, /\/report\/reef-report/);
    await expectMiroFishFrameSrc(student.classroom, /\/report\/reef-report/);

    await teacher.classroom.switchSurface('Lesson');
    await expect(teacher.classroom.miroFishFrame).toHaveCount(0);
    await expect(student.classroom.miroFishFrame).toHaveCount(0);

    await teacher.classroom.switchSurface('Simulation');
    await expectMiroFishFrameSrc(teacher.classroom, /\/simulation\/reef-lab\/start/);

    await teacher.classroom.openMiroFishManager();
    const manager = teacher.page.getByRole('dialog');
    await expect(
      manager.getByRole('button', { name: 'Grant control to Student One' }),
    ).toBeVisible();
    await manager.getByRole('button', { name: 'Grant control to Student One' }).click();
    await manager.getByRole('button', { name: 'Close', exact: true }).first().click();

    await expect(teacher.classroom.readOnlyOverlayHeading).toBeVisible();
    await expect(
      teacher.page.getByText('currently has control of the shared simulation.'),
    ).toBeVisible();
    await expect(teacher.page.getByText('Lease:')).toBeVisible();
    await expect(teacher.classroom.reclaimControlButton).toBeVisible();
    await expect(student.classroom.readOnlyOverlayHeading).toBeHidden();

    const revokeResult = await teacher.page.evaluate(async (activeClassroomId) => {
      const response = await fetch(
        `/api/classroom/${encodeURIComponent(activeClassroomId)}/control`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'revoke' }),
        },
      );

      return {
        ok: response.ok,
        status: response.status,
        body: await response.json().catch(() => null),
      };
    }, 'mirofish-single-room');
    expect(revokeResult.ok).toBe(true);

    await teacher.page.reload();
    await teacher.classroom.waitForLoaded();
    await expect(teacher.classroom.readOnlyOverlayHeading).toBeHidden();

    await student.page.bringToFront();
    await student.page.reload();
    await student.classroom.waitForLoaded();
    await expect(student.classroom.readOnlyOverlayHeading).toBeVisible();
  } finally {
    await teacherContext?.close();
    await studentContext?.close();
  }
});

test('multi-user classrooms issue participant embeds, moderate collaboration, and recover to lesson', async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const teacherSession = createAuthSession({
    role: 'teacher',
    userId: 'teacher-mirofish-multi',
    email: 'teacher-mirofish-multi@example.com',
    displayName: 'Teacher Multi',
    organizationId: 'org-mirofish-multi',
    organizationName: 'MiroFish Multi Academy',
    organizationSlug: 'mirofish-multi-academy',
  });
  const studentOneJoin = createJoinToken({
    classroomId: 'mirofish-multi-room',
    createdByUserId: teacherSession.user.id,
    organizationId: teacherSession.organization.id,
    displayName: 'Student One',
    rawToken: 'mirofish-multi-student-one',
  });
  const studentTwoJoin = createJoinToken({
    classroomId: 'mirofish-multi-room',
    createdByUserId: teacherSession.user.id,
    organizationId: teacherSession.organization.id,
    displayName: 'Student Two',
    rawToken: 'mirofish-multi-student-two',
  });

  await writePlatformStore({
    sessions: [teacherSession],
    joinTokens: [studentOneJoin.record, studentTwoJoin.record],
  });
  await writeClassroomData({
    classroomId: 'mirofish-multi-room',
    ownerUserId: teacherSession.user.id,
    organizationId: teacherSession.organization.id,
    stageName: 'Open Ocean Collaboration',
    sceneTitles: ['Swarm behaviour', 'Food web'],
    sharedSimulation: createAttachedSimulation(mockMiroFish!.baseUrl, {
      simulationId: 'open-ocean',
      activeSurface: 'lesson',
      collaborationMode: 'multi-user',
      collaborationState: 'live',
      allowStudentInteraction: true,
      mirofishSessionId: 'miro-session-live',
      status: 'running',
    }),
  });

  let teacherContext: BrowserContext | undefined;
  let studentOneContext: BrowserContext | undefined;
  let studentTwoContext: BrowserContext | undefined;

  try {
    const teacher = await createAuthedClassroomPage(
      browser,
      teacherSession.token,
      'mirofish-multi-room',
    );
    teacherContext = teacher.context;

    const studentOne = await joinClassroom(browser, studentOneJoin.rawToken, 'mirofish-multi-room');
    studentOneContext = studentOne.context;

    const studentTwo = await joinClassroom(browser, studentTwoJoin.rawToken, 'mirofish-multi-room');
    studentTwoContext = studentTwo.context;

    await expect(teacher.page.getByText('2 students')).toBeVisible({ timeout: 30_000 });

    await teacher.classroom.switchSurface('Simulation');
    await expectMiroFishFrameSrc(teacher.classroom, /\/simulation\/open-ocean\/start/, 30_000);

    const studentSessionResponse = await studentOne.page.request.post(
      `${APP_BASE_URL}/api/classroom/mirofish-multi-room/mirofish/session`,
      {
        data: {},
      },
    );
    const studentSessionJson = (await studentSessionResponse.json()) as {
      success?: boolean;
      error?: string;
      embedUrl?: string;
    };
    expect(studentSessionResponse.ok(), JSON.stringify(studentSessionJson)).toBeTruthy();
    expect(studentSessionJson.embedUrl).toContain('participantToken=');

    await expectMiroFishFrameSrc(studentOne.classroom, /participantToken=/, 30_000);
    await expectMiroFishFrameSrc(
      studentOne.classroom,
      /mirofishSessionId=miro-session-live/,
      30_000,
    );
    await expectMiroFishFrameSrc(studentTwo.classroom, /participantToken=/, 30_000);

    await teacher.classroom.openMiroFishManager();
    const manager = teacher.page.getByRole('dialog');
    await expect(manager.getByText('Student One')).toBeVisible();
    await expect(manager.getByText('Student Two')).toBeVisible();

    await manager.getByRole('button', { name: 'Freeze', exact: true }).click();
    await expect(studentOne.classroom.readOnlyOverlayHeading).toBeVisible();
    await expect(studentOne.page.getByText('temporarily frozen student interaction')).toBeVisible();

    await manager.getByRole('button', { name: 'Unfreeze', exact: true }).click();
    await expect(studentOne.classroom.readOnlyOverlayHeading).toBeHidden();

    await manager.getByRole('button', { name: 'Close', exact: true }).first().click();
    await expect(studentOne.classroom.readOnlyOverlayHeading).toBeVisible();
    await expect(studentOne.page.getByText('shared simulation is closed right now')).toBeVisible();

    await manager.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(studentOne.classroom.readOnlyOverlayHeading).toBeHidden();

    await manager.getByRole('button', { name: 'Spotlight Student Two' }).click();
    await expect(teacher.page.getByText('Spotlight: Student Two')).toBeVisible();

    await manager.getByRole('button', { name: 'Remove Student Two' }).click();
    await expect(studentTwo.classroom.readOnlyOverlayHeading).toBeVisible();
    await expect(studentTwo.page.getByText('removed this session')).toBeVisible();

    await manager.getByRole('button', { name: 'Close', exact: true }).last().click();
    await teacher.page.evaluate((mirofishOrigin) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: mirofishOrigin,
          data: {
            type: 'error',
            message: 'Mock MiroFish forced an embed failure.',
          },
        }),
      );
    }, mockMiroFish!.baseUrl);

    await expect(teacher.page.getByText('Mock MiroFish forced an embed failure.')).toBeVisible();
    await expect(teacher.classroom.miroFishFrame).toHaveCount(0, { timeout: 30_000 });
    await teacher.page.reload();
    await teacher.classroom.waitForLoaded();
    await studentOne.page.reload();
    await studentOne.classroom.waitForLoaded();
    await studentTwo.page.reload();
    await studentTwo.classroom.waitForLoaded();

    await expect(teacher.classroom.miroFishFrame).toHaveCount(0);
    await expect(studentOne.classroom.miroFishFrame).toHaveCount(0);
    await expect(studentTwo.classroom.miroFishFrame).toHaveCount(0);
  } finally {
    await teacherContext?.close();
    await studentOneContext?.close();
    await studentTwoContext?.close();
  }
});

test('join links reuse the same classroom session while a MiroFish simulation is attached', async ({
  browser,
}) => {
  test.setTimeout(45_000);

  const teacherSession = createAuthSession({
    role: 'teacher',
    userId: 'teacher-mirofish-reuse',
    email: 'teacher-mirofish-reuse@example.com',
    displayName: 'Teacher Reuse',
    organizationId: 'org-mirofish-reuse',
    organizationName: 'Reuse Academy',
    organizationSlug: 'reuse-academy',
  });
  const joinToken = createJoinToken({
    classroomId: 'mirofish-reuse-room',
    createdByUserId: teacherSession.user.id,
    organizationId: teacherSession.organization.id,
    displayName: 'Returning Student',
    rawToken: 'mirofish-reuse-student',
  });

  await writePlatformStore({
    sessions: [teacherSession],
    joinTokens: [joinToken.record],
  });
  await writeClassroomData({
    classroomId: 'mirofish-reuse-room',
    ownerUserId: teacherSession.user.id,
    organizationId: teacherSession.organization.id,
    stageName: 'Reuse Lab',
    sceneTitles: ['Attached intro'],
    sharedSimulation: createAttachedSimulation(mockMiroFish!.baseUrl, {
      simulationId: 'reuse-sim',
      activeSurface: 'simulation',
      collaborationMode: 'single-controller',
      collaborationState: 'inactive',
      allowStudentInteraction: false,
      status: 'running',
    }),
  });

  let studentContext: BrowserContext | undefined;

  try {
    const student = await joinClassroom(browser, joinToken.rawToken, 'mirofish-reuse-room');
    studentContext = student.context;

    await expectMiroFishFrameSrc(student.classroom, /\/simulation\/reuse-sim\/start/);

    await expect
      .poll(() => getCookieValue(student.context, 'raic_classroom_access'), { timeout: 15_000 })
      .toBeTruthy();
    const firstCookieValue = await getCookieValue(student.context, 'raic_classroom_access');
    expect(firstCookieValue).toBeTruthy();
    await expect.poll(() => countPersistedClassroomSessions('mirofish-reuse-room')).toBe(1);

    await student.page.goto(`${APP_BASE_URL}/join/${joinToken.rawToken}/enter`);
    await student.page.waitForURL(/\/classroom\/mirofish-reuse-room$/);
    await student.classroom.waitForLoaded();
    await waitForClassroomAccessCookie(student.context);
    await expectMiroFishFrameSrc(student.classroom, /\/simulation\/reuse-sim\/start/);

    await expect
      .poll(() => getCookieValue(student.context, 'raic_classroom_access'), { timeout: 15_000 })
      .toBe(firstCookieValue);
    await expect.poll(() => countPersistedClassroomSessions('mirofish-reuse-room')).toBe(1);
  } finally {
    await studentContext?.close();
  }
});

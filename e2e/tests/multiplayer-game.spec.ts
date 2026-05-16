import { promises as fs } from 'fs';
import path from 'path';
import type { Browser, Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import { ClassroomPage } from '../pages/classroom.page';
import {
  APP_BASE_URL,
  addSessionCookie,
  createAuthSession,
  createJoinToken,
  resetRaicData,
  startMockOpenAIServer,
  writeClassroomData,
  writePlatformStore,
} from './support/ai-governance';

test.describe.configure({ mode: 'serial' });
test.use({ locale: 'en-US' });

const CLASSROOM_ID = 'multiplayer-game-room';

interface MilestoneBenchmarkMetrics {
  firstMeaningfulPaintMs: number;
  classroomStartToFirstSceneMs: number;
  providerRoundtripP95Ms: number;
  classroomReuseReconnectMs: number;
}

function gameHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Multiplayer Test Game</title>
    <style>
      body { margin: 0; font-family: sans-serif; background: #06111f; color: #f8fafc; }
      main { min-height: 100vh; display: grid; place-items: center; gap: 12px; align-content: center; }
      button { min-height: 44px; border-radius: 8px; border: 1px solid #60a5fa; background: #0f172a; color: #f8fafc; padding: 8px 14px; }
      #status { color: #93c5fd; }
    </style>
  </head>
  <body>
    <main>
      <div id="status">Ready</div>
      <div id="score">Score: 0</div>
      <button id="start" type="button">Start</button>
      <button id="score-button" type="button">Score point</button>
    </main>
    <script type="application/json" id="widget-config">{"type":"game","gameType":"test","description":"Multiplayer test game","scoring":{}}</script>
    <script>
      let score = 0;
      let progress = 0;
      function post(event, payload) {
        window.parent.postMessage(Object.assign({ type: 'RAIC_GAME_EVENT', event }, payload || {}), '*');
      }
      function render(status) {
        document.getElementById('status').textContent = status;
        document.getElementById('score').textContent = 'Score: ' + score;
      }
      document.getElementById('start').addEventListener('click', () => {
        progress = Math.max(progress, 10);
        render('Playing');
        post('ready', { score, progress });
      });
      document.getElementById('score-button').addEventListener('click', () => {
        score += 10;
        progress = Math.min(100, progress + 40);
        render(progress >= 100 ? 'Complete' : 'Scored');
        post(progress >= 100 ? 'complete' : 'score', { score, progress, state: { score, progress } });
      });
      window.addEventListener('message', (event) => {
        const message = event.data || {};
        const payload = message.payload || {};
        if (message.type === 'RAIC_GAME_STATE' && message.gameSession) {
          if (message.gameSession.status === 'paused') render('Paused');
          if (message.gameSession.status === 'live') render('Playing');
          if (message.gameSession.status === 'idle') {
            score = 0;
            progress = 0;
            render('Ready');
          }
        }
        if (message.type === 'RAIC_GAME_CONTROL') {
          if (payload.action === 'request_bridge_ready') post('bridge_ready', { score, progress });
          if (payload.action === 'reset') {
            score = 0;
            progress = 0;
            render('Ready');
          }
        }
      });
      post('bridge_ready', { score, progress });
    </script>
  </body>
</html>`;
}

async function seedGameClassroom() {
  const classroom = await writeClassroomData({
    classroomId: CLASSROOM_ID,
    ownerUserId: 'teacher-1',
    organizationId: 'org-1',
    stageName: 'Multiplayer Game Lab',
    sceneTitles: ['Game'],
  });
  const now = Date.now();
  const gameScene = {
    id: `${CLASSROOM_ID}-game-scene`,
    stageId: CLASSROOM_ID,
    type: 'interactive' as const,
    title: 'Multiplayer Test Game',
    order: 0,
    content: {
      type: 'interactive' as const,
      widgetType: 'game' as const,
      html: gameHtml(),
    },
    actions: [],
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(
    path.join(process.cwd(), 'data', 'classrooms', `${CLASSROOM_ID}.json`),
    JSON.stringify(
      {
        ...classroom,
        roomVersion: 1,
        stage: {
          ...classroom.stage,
          sourceContext: { creationMode: 'game-arcade' },
        },
        scenes: [gameScene],
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function passAccessCodeIfNeeded(page: Page) {
  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) return;

  const accessCodeInput = page.getByPlaceholder('Access code');
  if (!(await accessCodeInput.isVisible({ timeout: 1_500 }).catch(() => false))) {
    return;
  }

  await accessCodeInput.fill(accessCode);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Enter access code' })).toBeHidden();
}

async function openTeacher(browser: Browser, token: string) {
  const context = await browser.newContext();
  await addSessionCookie(context, token);
  const page = await context.newPage();
  const classroom = new ClassroomPage(page);
  await page.goto(`${APP_BASE_URL}/classroom/${CLASSROOM_ID}`);
  await passAccessCodeIfNeeded(page);
  await classroom.waitForLoaded();
  return { context, page };
}

async function joinStudent(browser: Browser, rawToken: string, displayName: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${APP_BASE_URL}/join/${rawToken}`);
  await passAccessCodeIfNeeded(page);
  await page.getByRole('textbox', { name: 'Your display name' }).fill(displayName);
  await page.getByRole('button', { name: 'Enter classroom' }).click();
  await page.waitForURL(new RegExp(`/classroom/${CLASSROOM_ID}$`));
  await new ClassroomPage(page).waitForLoaded();
  return { context, page };
}

async function clickGameButton(page: Page, buttonId: string) {
  await page.frameLocator('iframe[title^="Interactive Scene"]').locator(`#${buttonId}`).click();
}

function percentile95(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return Math.round(sorted[index] ?? 0);
}

async function firstMeaningfulPaintMs(page: Page) {
  return page.evaluate(() => {
    const firstContentfulPaint = performance
      .getEntriesByType('paint')
      .find((entry) => entry.name === 'first-contentful-paint');
    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return Math.round(firstContentfulPaint?.startTime ?? navigation?.domContentLoadedEventEnd ?? 0);
  });
}

async function measureProviderRoundtripP95Ms() {
  const server = await startMockOpenAIServer();
  const timings: number[] = [];
  try {
    for (let index = 0; index < 5; index += 1) {
      const startedAt = performance.now();
      const response = await fetch(`${server.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer benchmark-test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'benchmark ping' }],
        }),
      });
      expect(response.ok).toBe(true);
      timings.push(performance.now() - startedAt);
    }
  } finally {
    await server.close();
  }

  return percentile95(timings);
}

async function writeBenchmarkMetrics(metrics: MilestoneBenchmarkMetrics) {
  const metricsPath = process.env.MILESTONE_BENCHMARK_METRICS_PATH;
  if (!metricsPath) return;

  await fs.mkdir(path.dirname(metricsPath), { recursive: true });
  await fs.writeFile(metricsPath, JSON.stringify(metrics, null, 2), 'utf8');
}

test.beforeEach(async () => {
  await resetRaicData();
  const teacher = createAuthSession({
    role: 'teacher',
    userId: 'teacher-1',
    email: 'teacher@example.test',
    displayName: 'Teacher',
    organizationId: 'org-1',
  });
  const studentOneJoin = createJoinToken({
    classroomId: CLASSROOM_ID,
    createdByUserId: 'teacher-1',
    organizationId: 'org-1',
    displayName: 'Multiplayer Game Lab',
    rawToken: 'student-one-join',
  });
  const studentTwoJoin = createJoinToken({
    classroomId: CLASSROOM_ID,
    createdByUserId: 'teacher-1',
    organizationId: 'org-1',
    displayName: 'Multiplayer Game Lab',
    rawToken: 'student-two-join',
  });
  await writePlatformStore({
    sessions: [teacher],
    joinTokens: [studentOneJoin.record, studentTwoJoin.record],
  });
  await seedGameClassroom();
});

test('teacher and two students can run a synchronized multiplayer game round', async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const teacher = createAuthSession({
    role: 'teacher',
    userId: 'teacher-1',
    email: 'teacher@example.test',
    displayName: 'Teacher',
    organizationId: 'org-1',
  });
  const classroomStartAt = Date.now();
  const teacherRoom = await openTeacher(browser, teacher.token);
  const classroomStartToFirstSceneMs = Date.now() - classroomStartAt;
  const firstPaintMs = await firstMeaningfulPaintMs(teacherRoom.page);
  const studentOne = await joinStudent(browser, 'student-one-join', 'Student One');
  const studentTwo = await joinStudent(browser, 'student-two-join', 'Student Two');

  await expect(teacherRoom.page.getByText('Multiplayer game', { exact: true })).toBeVisible();
  await expect(teacherRoom.page.getByText('Waiting for a student game bridge')).toBeHidden({
    timeout: 10_000,
  });

  await teacherRoom.page.getByRole('button', { name: 'Start round' }).click();
  await expect(
    studentOne.page.frameLocator('iframe[title^="Interactive Scene"]').locator('#status'),
  ).toHaveText('Playing', { timeout: 10_000 });
  await clickGameButton(studentOne.page, 'start');
  await clickGameButton(studentOne.page, 'score-button');
  await expect(teacherRoom.page.getByText('10 · 50%', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });

  await teacherRoom.page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(
    studentOne.page.frameLocator('iframe[title^="Interactive Scene"]').locator('#status'),
  ).toHaveText('Paused');
  const resumeGameButton = teacherRoom.page.getByRole('button', { name: 'Resume', exact: true });
  await expect(resumeGameButton).toBeEnabled({ timeout: 10_000 });
  await resumeGameButton.click();

  await teacherRoom.page.getByRole('button', { name: 'Shared control' }).click();
  await teacherRoom.page
    .locator('button[aria-label="Grant control to Student One"]:not([disabled])')
    .first()
    .click();
  const rejected = await studentTwo.page.evaluate(async (classroomId) => {
    const sessionResponse = await fetch(`/api/classroom/${classroomId}/game-session`, {
      cache: 'no-store',
    });
    const session = await sessionResponse.json();
    const response = await fetch(`/api/classroom/${classroomId}/game-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'control_input', roundId: session.roundId, input: { dx: 1 } }),
    });
    return response.status;
  }, CLASSROOM_ID);
  expect(rejected).toBe(403);

  const reconnectStartedAt = Date.now();
  await studentTwo.page.reload();
  await new ClassroomPage(studentTwo.page).waitForLoaded();
  await expect(studentTwo.page.getByText('Multiplayer game', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  const classroomReuseReconnectMs = Date.now() - reconnectStartedAt;

  await teacherRoom.page.getByRole('button', { name: 'Reset' }).click();
  await expect(
    studentOne.page.frameLocator('iframe[title^="Interactive Scene"]').locator('#score'),
  ).toHaveText('Score: 0');

  await teacherRoom.page.screenshot({
    path: testInfo.outputPath('multiplayer-host-desktop.png'),
    fullPage: true,
  });
  await studentOne.page.screenshot({
    path: testInfo.outputPath('multiplayer-student-desktop.png'),
    fullPage: true,
  });
  await teacherRoom.page.setViewportSize({ width: 375, height: 812 });
  await teacherRoom.page.screenshot({
    path: testInfo.outputPath('multiplayer-host-mobile.png'),
    fullPage: true,
  });
  await studentOne.page.setViewportSize({ width: 375, height: 812 });
  await studentOne.page.screenshot({
    path: testInfo.outputPath('multiplayer-student-mobile.png'),
    fullPage: true,
  });

  if (process.env.MILESTONE_BENCHMARK === '1') {
    await writeBenchmarkMetrics({
      firstMeaningfulPaintMs: firstPaintMs,
      classroomStartToFirstSceneMs,
      providerRoundtripP95Ms: await measureProviderRoundtripP95Ms(),
      classroomReuseReconnectMs,
    });
  }

  await Promise.all([
    teacherRoom.context.close(),
    studentOne.context.close(),
    studentTwo.context.close(),
  ]);
});

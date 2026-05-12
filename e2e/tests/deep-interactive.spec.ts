import { test, expect } from '../fixtures/base';
import { ClassroomPage } from '../pages/classroom.page';
import { createSettingsStorage } from '../fixtures/test-data/settings';
import { defaultTheme } from '../fixtures/test-data/scene-content';

const TEST_STAGE_ID = 'e2e-deep-interactive-stage';

const SETTINGS_STORAGE = createSettingsStorage({
  sidebarCollapsed: false,
  ttsEnabled: false,
});

const widgetHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Deep Interactive Widget</title>
  <style>
    html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
    body { display: grid; place-items: center; background: #f8fafc; color: #111827; }
    main { width: min(720px, calc(100vw - 32px)); padding: 24px; border: 1px solid #cbd5e1; background: white; }
    #angle-slider { width: 100%; min-height: 44px; }
    #angle-slider[data-highlighted="true"] { outline: 4px solid #7c3aed; }
    #secret[hidden] { display: none; }
  </style>
</head>
<body>
  <main>
    <h1>Projectile Motion</h1>
    <label for="angle-slider">Angle</label>
    <input id="angle-slider" type="range" min="0" max="90" value="45" />
    <p id="secret" hidden>Revealed teacher note</p>
    <p id="status">ready</p>
  </main>
  <script>
    window.addEventListener('message', (event) => {
      const message = event.data || {};
      const status = document.getElementById('status');
      if (message.type === 'HIGHLIGHT_ELEMENT') {
        document.querySelector(message.target)?.setAttribute('data-highlighted', 'true');
        status.textContent = 'highlighted:' + message.target;
      }
      if (message.type === 'SET_WIDGET_STATE') {
        document.body.dataset.angle = String(message.state?.angle ?? '');
        status.textContent = 'state:' + document.body.dataset.angle;
      }
      if (message.type === 'REVEAL_ELEMENT') {
        const target = document.querySelector(message.target);
        if (target) target.hidden = false;
        status.textContent = 'revealed:' + message.target;
      }
    });
  </script>
</body>
</html>`;

async function seedDeepInteractiveDatabase(page: import('@playwright/test').Page) {
  await page.addInitScript(
    ({ settings, stageId }) => {
      localStorage.setItem('settings-storage', settings);
      sessionStorage.setItem(
        'classroomLaunchContext',
        JSON.stringify({
          classroomId: stageId,
          launchMode: 'public-demo',
          homePath: '/',
        }),
      );
    },
    { settings: SETTINGS_STORAGE, stageId: TEST_STAGE_ID },
  );

  await page.goto('/', { waitUntil: 'networkidle' });

  await page.evaluate(
    ({ stageId, theme, html }) => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('RAIC-Database');
        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction(['stages', 'scenes', 'stageOutlines'], 'readwrite');
          const now = Date.now();

          tx.objectStore('stages').put({
            id: stageId,
            name: 'Deep Interactive fixture',
            description: '',
            language: 'en-US',
            style: 'interactive',
            interactiveMode: true,
            createdAt: now,
            updatedAt: now,
          });

          tx.objectStore('scenes').put({
            id: 'scene-widget',
            stageId,
            type: 'interactive',
            title: 'Projectile Widget',
            order: 0,
            content: {
              type: 'interactive',
              url: '',
              html,
              widgetType: 'simulation',
              widgetConfig: {
                type: 'simulation',
                concept: 'Projectile motion',
                description: 'Change launch angle',
                variables: [{ name: 'angle', label: 'Angle', min: 0, max: 90, default: 45 }],
              },
            },
            actions: [
              { id: 'action-highlight', type: 'widget_highlight', target: '#angle-slider' },
              { id: 'action-state', type: 'widget_setState', state: { angle: 60 } },
              { id: 'action-reveal', type: 'widget_reveal', target: '#secret' },
            ],
            createdAt: now,
            updatedAt: now,
          });

          tx.objectStore('scenes').put({
            id: 'scene-slide',
            stageId,
            type: 'slide',
            title: 'Summary',
            order: 1,
            content: {
              type: 'slide',
              canvas: {
                id: 'slide-summary',
                viewportSize: 1000,
                viewportRatio: 0.5625,
                theme,
                elements: [
                  {
                    type: 'text',
                    id: 'summary-title',
                    content: 'Summary',
                    left: 50,
                    top: 50,
                    width: 900,
                    height: 100,
                  },
                ],
              },
            },
            createdAt: now,
            updatedAt: now,
          });

          tx.objectStore('stageOutlines').put({
            stageId,
            outlines: [],
            createdAt: now,
            updatedAt: now,
          });

          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
    { stageId: TEST_STAGE_ID, theme: defaultTheme, html: widgetHtml },
  );
}

test.describe('Deep Interactive classroom playback', () => {
  test.beforeEach(async ({ page }) => {
    await seedDeepInteractiveDatabase(page);
  });

  test('renders widget iframe and dispatches teacher playback messages', async ({ page }) => {
    const classroom = new ClassroomPage(page);
    await classroom.goto(TEST_STAGE_ID);
    await classroom.waitForLoaded();

    const widgetFrame = page.frameLocator('iframe[title="Interactive Scene scene-widget"]');
    await expect(widgetFrame.locator('#status')).toHaveText('ready');

    await page.getByRole('button', { name: 'Play', exact: true }).click();

    await expect(widgetFrame.locator('#status')).toHaveText('revealed:#secret');
    await expect(widgetFrame.locator('body')).toHaveAttribute('data-angle', '60');
    await expect(widgetFrame.locator('#angle-slider')).toHaveAttribute('data-highlighted', 'true');
    await expect(widgetFrame.locator('#secret')).toBeVisible();

    await classroom.clickScene(1);
    await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible();
    await expect(page.locator('iframe[title="Interactive Scene scene-widget"]')).toHaveCount(0);
  });

  test('keeps the widget visible on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const classroom = new ClassroomPage(page);
    await classroom.goto(TEST_STAGE_ID);
    await classroom.waitForLoaded();
    await page.getByRole('button', { name: 'Fullscreen' }).click();

    const iframe = page.locator('iframe[title="Interactive Scene scene-widget"]');
    await expect(iframe).toBeVisible();
    const box = await iframe.boundingBox();
    expect(box?.width).toBeGreaterThan(120);
    expect(box?.height).toBeGreaterThan(180);
    await expect(
      page.frameLocator('iframe[title="Interactive Scene scene-widget"]').locator('#status'),
    ).toHaveText('ready');
  });
});

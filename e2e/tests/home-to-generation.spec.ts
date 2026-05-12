import { test, expect } from '../fixtures/base';
import { HomePage } from '../pages/home.page';
import { createSettingsStorage } from '../fixtures/test-data/settings';

// Inject settings with modelId so the "enter classroom" button works
const SETTINGS_STORAGE = createSettingsStorage();

function getTomorrowScheduleParts() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(15, 30, 0, 0);
  return {
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`,
    time: '15:30',
  };
}

async function readCapturedGenerationSession(page: import('@playwright/test').Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('e2e:lastGenerationSession') || 'null'),
  );
}

async function clearCapturedGenerationSession(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    localStorage.removeItem('e2e:lastGenerationSession');
    sessionStorage.removeItem('generationSession');
  });
}

test.describe('Home → Generation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((settings) => {
      localStorage.setItem('settings-storage', settings);
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItemWithGenerationCapture(key, value) {
        if (this === window.sessionStorage && key === 'generationSession') {
          window.localStorage.setItem('e2e:lastGenerationSession', value);
        }
        return originalSetItem.call(this, key, value);
      };
      if (!sessionStorage.getItem('home-to-generation-initialized')) {
        localStorage.removeItem('interactiveModeEnabled');
        localStorage.removeItem('requirementDraft');
        localStorage.removeItem('e2e:lastGenerationSession');
        sessionStorage.setItem('home-to-generation-initialized', 'true');
      }
    }, SETTINGS_STORAGE);
  });

  test('home page loads with core UI elements and submits requirement', async ({ page }) => {
    await page.route('**/api/generate/scene-outlines-stream', (route) => {
      route.fulfill({
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Generation intentionally stopped by e2e navigation test' }),
      });
    });

    const home = new HomePage(page);
    await home.goto();

    // Core elements visible
    await expect(home.logo).toBeVisible();
    await expect(home.textarea).toBeVisible();
    await expect(home.enterButton).toBeDisabled();

    // Type requirement → button activates
    await home.fillRequirement('讲解光合作用');
    await expect(home.enterButton).toBeEnabled();

    // Submit → navigate to generation-preview
    await home.submit();
    await page.waitForURL(/\/generation-preview/);
    expect(page.url()).toContain('/generation-preview');
  });

  test('Deep Interactive switch toggles, persists, and controls generation payload', async ({
    page,
  }) => {
    await page.route('**/api/generate/scene-outlines-stream', (route) => {
      route.fulfill({
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Generation intentionally stopped by e2e toggle test' }),
      });
    });

    const home = new HomePage(page);
    await home.goto();

    await expect(home.deepInteractiveSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(home.deepInteractiveState).toHaveText('Off');

    await home.deepInteractiveSwitch.click();
    await expect(home.deepInteractiveSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(home.deepInteractiveState).toHaveText('On');

    await page.reload();
    await expect(home.deepInteractiveSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(home.deepInteractiveState).toHaveText('On');

    await home.setGenerationLanguage('en-US');
    await expect(home.generationLanguageToggle).toHaveText('EN');
    await home.fillRequirement('Build an orbital mechanics lab');
    await clearCapturedGenerationSession(page);
    await home.submit();
    await page.waitForURL(/\/generation-preview/);
    const enabledSession = await readCapturedGenerationSession(page);
    expect(enabledSession.requirements.language).toBe('en-US');
    expect(enabledSession.requirements.interactiveMode).toBe(true);

    await home.goto();
    await expect(home.deepInteractiveSwitch).toHaveAttribute('aria-checked', 'true');
    await home.deepInteractiveSwitch.click();
    await expect(home.deepInteractiveSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(home.deepInteractiveState).toHaveText('Off');

    await home.fillRequirement('Build a standard lecture');
    await clearCapturedGenerationSession(page);
    await home.submit();
    await page.waitForURL(/\/generation-preview/);
    const disabledSession = await readCapturedGenerationSession(page);
    expect(disabledSession.requirements.interactiveMode).toBeUndefined();
  });

  test('Game mode chooses an arcade template and stores game requirements', async ({ page }) => {
    await page.route('**/api/generate/scene-outlines-stream', (route) => {
      route.fulfill({
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Generation intentionally stopped by e2e game mode test' }),
      });
    });

    const home = new HomePage(page);
    await home.goto();

    await expect(home.courseModeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(home.gameTemplateSelector).toBeHidden();
    await expect(home.deepInteractiveSwitch).toHaveAttribute('aria-checked', 'false');

    await home.gameModeButton.click();
    await expect(home.gameModeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(home.gameTemplateSelector).toBeVisible();
    await expect(home.deepInteractiveSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(home.deepInteractiveState).toHaveText('On');

    await home.setGenerationLanguage('en-US');
    await expect(home.generationLanguageToggle).toHaveText('EN');
    await home.gameTemplateButton('puzzle-lab').click();
    await home.fillRequirement('Teach cellular respiration as a sorting challenge');
    await clearCapturedGenerationSession(page);
    await home.submit();
    await page.waitForURL(/\/generation-preview/);
    const gameSession = await readCapturedGenerationSession(page);
    expect(gameSession.requirements).toMatchObject({
      creationMode: 'game-arcade',
      gameTemplateId: 'puzzle-lab',
      interactiveMode: true,
      language: 'en-US',
    });
    expect(gameSession.requirements.gameCreativeBrief).toContain('Puzzle Lab');
    expect(gameSession.requirements.gameCreativeBrief).toContain('cellular respiration');

    await home.goto();
    await home.courseModeButton.click();
    await expect(home.courseModeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(home.gameTemplateSelector).toBeHidden();
    await expect(home.deepInteractiveSwitch).toHaveAttribute('aria-checked', 'false');

    await home.fillRequirement('Teach cellular respiration as a normal classroom');
    await clearCapturedGenerationSession(page);
    await home.submit();
    await page.waitForURL(/\/generation-preview/);
    const courseSession = await readCapturedGenerationSession(page);
    expect(courseSession.requirements.creationMode).toBeUndefined();
    expect(courseSession.requirements.gameTemplateId).toBeUndefined();
    expect(courseSession.requirements.gameCreativeBrief).toBeUndefined();
    expect(courseSession.requirements.interactiveMode).toBeUndefined();
  });

  test('public demo schedule creates a class and keeps it after refresh', async ({
    page,
    mockApi,
  }) => {
    await mockApi.setupGenerationMocks();

    const home = new HomePage(page);
    await home.goto();

    const schedule = page.getByTestId('schedule-classes-box');
    await expect(schedule).toBeVisible();
    await expect(schedule.getByText('No classes scheduled')).toBeVisible();

    const scheduleStart = getTomorrowScheduleParts();
    await schedule.getByRole('button', { name: 'Add' }).click();
    await page.getByLabel('Class title').fill('Design critique');
    await page.getByLabel('Date').fill(scheduleStart.date);
    await page.getByLabel('Time').fill(scheduleStart.time);
    await page.getByLabel('Duration').fill('45');
    await Promise.all([
      page.waitForURL(/\/classroom\//),
      page.getByRole('button', { name: 'Create' }).click(),
    ]);

    await home.goto();
    await expect(
      page.getByTestId('schedule-classes-box').getByRole('button', { name: /Design critique/ }),
    ).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await expect(
      page.getByTestId('schedule-classes-box').getByRole('button', { name: /Design critique/ }),
    ).toBeVisible();
  });
});

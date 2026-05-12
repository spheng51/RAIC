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

test.describe('Home → Generation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((settings) => {
      localStorage.setItem('settings-storage', settings);
    }, SETTINGS_STORAGE);
  });

  test('home page loads with core UI elements and submits requirement', async ({ page }) => {
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

  test('public demo schedule creates a class and keeps it after refresh', async ({ page }) => {
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
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(schedule.getByText('Design critique')).toBeVisible();
    await page.reload();
    await expect(
      page.getByTestId('schedule-classes-box').getByText('Design critique'),
    ).toBeVisible();
  });
});

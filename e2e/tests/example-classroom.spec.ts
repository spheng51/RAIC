import { expect, test } from '../fixtures/base';
import type { Page } from '@playwright/test';

const EXAMPLE_COURSE_ID = 'openraic-rit-diff-by-band';
const EXAMPLE_NOTICE =
  "This classroom was loaded from this browser's local storage and is only available on this device.";

test.use({ locale: 'en-US' });

function mockMissingServerClassroomResponse(page: Page) {
  return page.route('**/api/classroom?id=*', (route) => {
    route.fulfill({
      status: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Classroom not found' }),
    });
  });
}

function getSceneItem(page: Page, index: number) {
  return page.getByTestId('scene-list').getByTestId('scene-item').nth(index);
}

test.describe('Open-RAIC public example classroom', () => {
  test('home CTA opens seeded classroom', async ({ page }) => {
    await mockMissingServerClassroomResponse(page);

    await page.goto('/');
    await page.getByTestId('open-example-classroom-button').click();

    await page.waitForURL(`/classroom/${EXAMPLE_COURSE_ID}`);
    await expect(getSceneItem(page, 0)).toContainText('RIT Input + Grouping Strategy');
    await expect(getSceneItem(page, 1)).toContainText('Differentiated prompt examples');
    await expect(page.getByText(EXAMPLE_NOTICE)).toBeVisible();
  });

  test('deep-link /example seeds and opens the example', async ({ page }) => {
    await mockMissingServerClassroomResponse(page);

    await page.goto('/example');

    await page.waitForURL(`/classroom/${EXAMPLE_COURSE_ID}`);
    await expect(getSceneItem(page, 0)).toContainText('RIT Input + Grouping Strategy');
    await expect(getSceneItem(page, 1)).toContainText('Differentiated prompt examples');
    await expect(page.getByText(EXAMPLE_NOTICE)).toBeVisible();
  });

  test('direct classroom URL without launch context fails to open example data', async ({
    page,
  }) => {
    await mockMissingServerClassroomResponse(page);

    await page.goto('/example');
    await expect(page.getByText(EXAMPLE_NOTICE)).toBeVisible();
    await page.goto('/');
    await page.goto(`/classroom/${EXAMPLE_COURSE_ID}`);

    await expect(page.getByRole('heading', { name: 'Error' })).toBeVisible();
    await expect(page.getByText(EXAMPLE_NOTICE)).not.toBeVisible();
  });
});

import type { Page, Locator } from '@playwright/test';

export class ClassroomPage {
  readonly page: Page;
  readonly loadingText: Locator;
  readonly sidebarScenes: Locator;
  readonly manageMiroFishButton: Locator;
  readonly miroFishDialogTitle: Locator;
  readonly miroFishFrame: Locator;
  readonly readOnlyOverlayHeading: Locator;
  readonly reclaimControlButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.loadingText = page.getByText('Loading classroom...');
    this.sidebarScenes = page.locator('[data-testid="scene-item"]');
    this.manageMiroFishButton = page.getByRole('button', { name: 'Manage MiroFish' });
    this.miroFishDialogTitle = page.getByRole('heading', { name: 'MiroFish classroom sidecar' });
    this.miroFishFrame = page.locator('iframe[title="MiroFish Classroom Pane"]');
    this.readOnlyOverlayHeading = page.getByRole('heading', {
      name: /Read-only (classroom|collaboration) view/,
    });
    this.reclaimControlButton = page.getByRole('button', { name: 'Reclaim control' });
  }

  async goto(stageId: string) {
    await this.page.goto(`/classroom/${stageId}`);
  }

  async waitForLoaded() {
    await this.loadingText.waitFor({ state: 'hidden', timeout: 15_000 });
  }

  async clickScene(index: number) {
    await this.sidebarScenes.nth(index).click();
  }

  /** Get scene title — it's the second span (first is the number badge) */
  getSceneTitle(index: number) {
    return this.sidebarScenes.nth(index).locator('[data-testid="scene-title"]');
  }

  surfaceButton(label: 'Lesson' | 'Simulation' | 'Report') {
    return this.page.getByRole('button', { name: label, exact: true }).last();
  }

  async switchSurface(label: 'Lesson' | 'Simulation' | 'Report') {
    await this.surfaceButton(label).click();
  }

  async openMiroFishManager() {
    await this.manageMiroFishButton.click();
    await this.miroFishDialogTitle.waitFor({ state: 'visible', timeout: 10_000 });
  }

  miroFishFrameLocator() {
    return this.page.frameLocator('iframe[title="MiroFish Classroom Pane"]');
  }
}

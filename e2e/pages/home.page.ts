import type { Page, Locator } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly logo: Locator;
  readonly textarea: Locator;
  readonly enterButton: Locator;
  readonly deepInteractiveSwitch: Locator;
  readonly deepInteractiveState: Locator;
  readonly courseModeButton: Locator;
  readonly gameModeButton: Locator;
  readonly gameTemplateSelector: Locator;
  readonly generationLanguageToggle: Locator;

  constructor(page: Page) {
    this.page = page;
    this.logo = page.locator('img[alt="Open-RAIC"]');
    this.textarea = page.locator('textarea');
    this.enterButton = page
      .getByRole('button', { name: /enter/i })
      .or(page.locator('button:has-text("进入课堂")'));
    this.deepInteractiveSwitch = page.getByRole('switch', { name: /deep interactive/i });
    this.deepInteractiveState = page.getByTestId('deep-interactive-state');
    this.courseModeButton = page.getByTestId('creation-mode-course');
    this.gameModeButton = page.getByTestId('creation-mode-game');
    this.gameTemplateSelector = page.getByTestId('game-template-selector');
    this.generationLanguageToggle = page.getByTestId('generation-language-toggle');
  }

  async goto() {
    await this.page.goto('/');
  }

  async fillRequirement(text: string) {
    await this.textarea.fill(text);
  }

  async submit() {
    await this.enterButton.click();
  }

  gameTemplateButton(templateId: string) {
    return this.page.getByTestId(`game-template-${templateId}`);
  }

  async setGenerationLanguage(language: 'en-US' | 'zh-CN') {
    const expectedLabel = language === 'en-US' ? 'EN' : '中文';
    const currentLabel = (await this.generationLanguageToggle.textContent())?.trim();
    if (currentLabel !== expectedLabel) {
      await this.generationLanguageToggle.click();
    }
  }
}

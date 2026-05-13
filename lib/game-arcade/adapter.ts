import type { SceneOutline, WidgetOutline } from '@/lib/types/generation';
import { getGameTemplateDefinition } from '@/lib/game-arcade/templates';
import { getCourseLanguageLabels } from '@/lib/generation/language-directive';

export interface GameArcadeAdapterContext {
  outline: SceneOutline;
  widgetOutline: WidgetOutline;
  languageDirective?: string;
}

export interface GameArcadeHtmlAdapter {
  id: string;
  label: string;
  buildPromptVariables(context: GameArcadeAdapterContext): Record<string, unknown>;
}

export function buildGameWidgetPromptVariables({
  outline,
  widgetOutline,
  languageDirective,
}: GameArcadeAdapterContext): Record<string, unknown> {
  const gameTemplate = getGameTemplateDefinition(widgetOutline.gameTemplateId);
  const keyPoints = (outline.keyPoints || []).join('\n');
  const languageLabels = getCourseLanguageLabels(outline.language);

  return {
    title: outline.title,
    gameType: widgetOutline.gameType || 'action',
    description: outline.description,
    keyPoints,
    gameTemplateLabel: gameTemplate.label,
    gameTemplateHint: gameTemplate.promptHint,
    gamePreferredControls: gameTemplate.preferredControls.join(', '),
    gameQaExpectations: gameTemplate.qaExpectations.join(', '),
    gameGoal: widgetOutline.gameGoal || widgetOutline.challenge || outline.description,
    coreMechanic: widgetOutline.coreMechanic || gameTemplate.promptHint,
    difficultyCurve: widgetOutline.difficultyCurve || 'standard',
    scoring: { correctPoints: 10, speedBonus: 5 },
    challenge: widgetOutline.challenge || '',
    playerControls: widgetOutline.playerControls || [],
    languageDirective: languageDirective || '',
    courseLanguageName: languageLabels.courseLanguageName,
    htmlLang: languageLabels.htmlLang,
    gameStartLabel: languageLabels.startLabel,
    gameRestartLabel: languageLabels.restartLabel,
    gameHintLabel: languageLabels.hintLabel,
    gameScoreLabel: languageLabels.scoreLabel,
    gameStatusLabel: languageLabels.statusLabel,
    gameProgressLabel: languageLabels.progressLabel,
    gamePauseLabel: languageLabels.pauseLabel,
    gameResumeLabel: languageLabels.resumeLabel,
  };
}

export const promptGameWidgetAdapter: GameArcadeHtmlAdapter = {
  id: 'prompt-game-widget',
  label: 'Prompt-generated classroom game widget',
  buildPromptVariables: buildGameWidgetPromptVariables,
};

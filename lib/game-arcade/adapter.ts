import type { SceneOutline, WidgetOutline } from '@/lib/types/generation';
import { getGameTemplateDefinition } from '@/lib/game-arcade/templates';

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
  };
}

export const promptGameWidgetAdapter: GameArcadeHtmlAdapter = {
  id: 'prompt-game-widget',
  label: 'Prompt-generated classroom game widget',
  buildPromptVariables: buildGameWidgetPromptVariables,
};

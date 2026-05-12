import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GAME_TEMPLATE_ID,
  GAME_TEMPLATE_DEFINITIONS,
  formatGameTemplateForPrompt,
  getGameTemplateDefinition,
} from '@/lib/game-arcade/templates';
import { promptGameWidgetAdapter } from '@/lib/game-arcade/adapter';
import { validateGameWidgetHtml } from '@/lib/game-arcade/qa';
import { buildPrompt, PROMPT_IDS } from '@/lib/generation/prompts';
import {
  buildCourseLanguageDirective,
  generateSceneOutlinesFromRequirements,
} from '@/lib/generation/outline-generator';
import { generateSceneContent } from '@/lib/generation/scene-generator';
import type { GeneratedInteractiveContent, SceneOutline } from '@/lib/types/generation';

const validGameHtml = `<!DOCTYPE html>
<html>
<head><title>Cell Sprint</title></head>
<body>
  <main id="game-container">
    <section id="start-screen">
      <button id="start-button" onclick="startGame()">Start Game</button>
    </section>
    <div id="score-display">Score: 0</div>
    <div id="status-panel">Ready</div>
  </main>
  <script type="application/json" id="widget-config">
    {
      "type": "game",
      "gameType": "puzzle",
      "description": "Sort energy steps into the right order.",
      "gameConfig": { "controls": ["drag_cards"], "levels": [1, 2] },
      "scoring": { "completionPoints": 50 }
    }
  </script>
  <script>
    let gameOver = false;
    function startGame() {
      document.getElementById('status-panel').textContent = 'Playing';
      requestAnimationFrame(function tick() {});
    }
  </script>
</body>
</html>`;

const gameOutline: SceneOutline = {
  id: 'game-1',
  type: 'interactive',
  title: 'Cell Respiration Puzzle Lab',
  description: 'Sort molecules and energy transfers into the right sequence.',
  keyPoints: ['Glycolysis', 'Krebs cycle', 'Electron transport chain'],
  order: 1,
  language: 'en-US',
  widgetType: 'game',
  widgetOutline: {
    gameTemplateId: 'puzzle-lab',
    gameType: 'puzzle',
    gameGoal: 'Build the respiration pathway by sorting draggable cards.',
    coreMechanic: 'Drag molecule cards into a reaction sequence.',
    difficultyCurve: 'gentle',
    challenge: 'Complete two pathway levels without losing progress.',
    playerControls: ['drag-and-drop', 'hint button', 'reset button'],
  },
};

describe('Classroom Game Studio generation', () => {
  it('exposes a stable arcade template registry', () => {
    expect(DEFAULT_GAME_TEMPLATE_ID).toBe('physics-challenge');
    expect(GAME_TEMPLATE_DEFINITIONS.map((template) => template.id)).toEqual([
      'physics-challenge',
      'puzzle-lab',
      'strategy-sim',
      'card-match',
      'code-quest',
      'boss-review',
    ]);
    expect(getGameTemplateDefinition('puzzle-lab')).toMatchObject({
      label: 'Puzzle Lab',
      preferredControls: expect.arrayContaining(['drag-and-drop']),
    });
    expect(formatGameTemplateForPrompt('boss-review')).toContain('Boss Review');
  });

  it('keeps game widget prompt generation behind an adapter seam', () => {
    const variables = promptGameWidgetAdapter.buildPromptVariables({
      outline: gameOutline,
      widgetOutline: gameOutline.widgetOutline!,
      languageDirective: 'Teach in English.',
    });

    expect(promptGameWidgetAdapter.id).toBe('prompt-game-widget');
    expect(variables).toMatchObject({
      gameTemplateLabel: 'Puzzle Lab',
      gameGoal: 'Build the respiration pathway by sorting draggable cards.',
      languageDirective: 'Teach in English.',
      courseLanguageName: 'English',
      htmlLang: 'en-US',
      gameStartLabel: 'Start Game',
      gameScoreLabel: 'Score',
    });
  });

  it('keeps English game prompts free of Chinese UI label examples', () => {
    const variables = promptGameWidgetAdapter.buildPromptVariables({
      outline: gameOutline,
      widgetOutline: gameOutline.widgetOutline!,
      languageDirective: buildCourseLanguageDirective('en-US'),
    });
    const prompt = buildPrompt(PROMPT_IDS.GAME_CONTENT, variables);
    const promptText = `${prompt?.system}\n${prompt?.user}`;

    expect(promptText).toContain('Target language: English');
    expect(promptText).toContain('<html lang="en-US">');
    expect(promptText).toContain('<button onclick="startGame()">Start Game</button>');
    for (const leakedLabel of ['开始', '任务', '分数', '提示', '重新开始']) {
      expect(promptText).not.toContain(leakedLabel);
    }
  });

  it('loads the game-arcade outline prompt with template context', () => {
    const prompt = buildPrompt(PROMPT_IDS.GAME_ARCADE_OUTLINES, {
      requirement: 'Teach cellular respiration as a game',
      language: 'en-US',
      pdfContent: 'None',
      availableImages: 'No images available',
      researchContext: 'None',
      teacherContext: '',
      userProfile: '',
      languageDirective: 'Teach in English.',
      gameTemplateContext: formatGameTemplateForPrompt('puzzle-lab'),
      gameCreativeBrief: 'Make a sorting puzzle.',
    });

    expect(prompt?.system).toContain('Game Arcade Classroom Outline Planner');
    expect(prompt?.user).toContain('Puzzle Lab');
    expect(prompt?.user).toContain('70%');
    expect(prompt?.user).toContain('widgetType');
  });

  it('selects game-arcade outlines and preserves game metadata', async () => {
    const aiCall = vi.fn(async (_system: string, _user: string) =>
      JSON.stringify({
        languageDirective: 'Teach in English.',
        outlines: [gameOutline],
      }),
    );

    const result = await generateSceneOutlinesFromRequirements(
      {
        requirement: 'Teach cellular respiration as a game',
        language: 'en-US',
        interactiveMode: true,
        creationMode: 'game-arcade',
        gameTemplateId: 'puzzle-lab',
        gameCreativeBrief: 'Make a drag-and-drop puzzle lab.',
      },
      undefined,
      undefined,
      aiCall,
    );

    expect(result.success).toBe(true);
    expect(aiCall.mock.calls[0][0]).toContain('Game Arcade Classroom Outline Planner');
    expect(aiCall.mock.calls[0][1]).toContain('Puzzle Lab');
    expect(aiCall.mock.calls[0][1]).toContain(
      'All generated classroom content must be written in English.',
    );
    expect(result.data?.outlines[0]).toMatchObject({
      type: 'interactive',
      widgetType: 'game',
      widgetOutline: {
        gameTemplateId: 'puzzle-lab',
        coreMechanic: 'Drag molecule cards into a reaction sequence.',
      },
    });
  });

  it('threads template and language directives through game content generation', async () => {
    const aiCall = vi.fn(async (_system: string, user: string) => {
      if (user.includes('Create an educational GAME widget')) {
        return validGameHtml;
      }
      if (user.includes('Generate teacher actions')) {
        return JSON.stringify({
          actions: [
            {
              id: 'intro',
              type: 'speech',
              content: 'Let us build the pathway.',
              label: 'Intro',
            },
            {
              id: 'highlight_score',
              type: 'highlight',
              target: '#score-display',
              content: 'Score tracks accurate sorting.',
              label: 'Score',
            },
          ],
        });
      }
      throw new Error(`Unexpected prompt: ${user.slice(0, 80)}`);
    });

    const content = (await generateSceneContent(gameOutline, aiCall, {
      languageDirective: 'Teach in English with short labels.',
    })) as GeneratedInteractiveContent;

    expect(content.widgetType).toBe('game');
    expect(content.widgetConfig).toMatchObject({
      type: 'game',
      gameType: 'puzzle',
    });
    expect(content.teacherActions).toHaveLength(2);
    expect(aiCall.mock.calls[0][1]).toContain('Puzzle Lab');
    expect(aiCall.mock.calls[0][1]).toContain('Target language: English');
    expect(aiCall.mock.calls[0][1]).toContain('<html lang="en-US">');
    expect(aiCall.mock.calls[0][1]).toContain('Teach in English with short labels.');
    expect(aiCall.mock.calls[1][1]).toContain('Teach in English with short labels.');
  });

  it('falls back to a playable game shell when generated game HTML fails QA', async () => {
    const invalidGameHtml = `<!DOCTYPE html>
<html>
<body>
  <main>
    <h1>Welcome to the Water Molecule Lab</h1>
    <p>This intro missed the required game widget structure.</p>
  </main>
</body>
</html>`;
    const aiCall = vi.fn(async (_system: string, user: string) => {
      if (user.includes('Create an educational GAME widget')) {
        return invalidGameHtml;
      }
      if (user.includes('Generate teacher actions')) {
        return JSON.stringify({ actions: [] });
      }
      throw new Error(`Unexpected prompt: ${user.slice(0, 80)}`);
    });

    const content = (await generateSceneContent(gameOutline, aiCall, {
      languageDirective: 'Teach in English with short labels.',
    })) as GeneratedInteractiveContent;

    expect(content.widgetType).toBe('game');
    expect(content.html).toContain('data-game-fallback="true"');
    expect(content.widgetConfig).toMatchObject({
      type: 'game',
      gameType: 'puzzle',
      gameConfig: {
        fallback: true,
        templateId: 'puzzle-lab',
        htmlLang: 'en-US',
      },
    });
    expect(content.teacherActions?.map((action) => action.id)).toContain('intro_game_goal');
    expect(
      validateGameWidgetHtml(content.html, content.widgetConfig, content.teacherActions).valid,
    ).toBe(true);
  });

  it('validates generated game HTML before persistence', () => {
    const valid = validateGameWidgetHtml(
      validGameHtml,
      {
        type: 'game',
        gameType: 'puzzle',
        description: 'Sort energy steps.',
        scoring: { completionPoints: 50 },
      },
      [{ id: 'highlight', type: 'highlight', target: '#score-display' }],
    );
    expect(valid.valid).toBe(true);

    expect(validateGameWidgetHtml(`${validGameHtml}\n${validGameHtml}`).errors).toContain(
      'Game HTML must contain exactly one HTML document.',
    );
    expect(
      validateGameWidgetHtml(
        '<!DOCTYPE html><html><body><button onclick="startGame()">Start</button><div id="score-display">Score</div></body></html>',
      ).errors,
    ).toContain('Game HTML must embed a widget-config JSON script.');
    expect(
      validateGameWidgetHtml(
        '<!DOCTYPE html><html><body><script type="application/json" id="widget-config">{"type":"game"}</script><div id="score-display">Score</div></body></html>',
        { type: 'game', gameType: 'puzzle', description: 'Puzzle', scoring: {} },
      ).errors,
    ).toContain('Game HTML must expose a start control.');
    expect(
      validateGameWidgetHtml(
        '<!DOCTYPE html><html><body><button onclick="startGame()">Start</button><div id="score-display">Score</div><script type="application/json" id="widget-config">{"type":"game"}</script><script>let gameOver = true;</script></body></html>',
        { type: 'game', gameType: 'puzzle', description: 'Puzzle', scoring: {} },
      ).errors,
    ).toContain('Game HTML must not start in an immediate failure state.');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { buildPrompt, PROMPT_IDS } from '@/lib/generation/prompts';
import {
  applyOutlineFallbacks,
  generateSceneOutlinesFromRequirements,
} from '@/lib/generation/outline-generator';
import {
  generateSceneActions,
  generateSceneContent,
} from '@/lib/generation/scene-generator';
import { buildCompleteScene } from '@/lib/generation/scene-builder';
import type {
  GeneratedInteractiveContent,
  SceneOutline,
} from '@/lib/types/generation';

const widgetOutline: SceneOutline = {
  id: 'scene-widget',
  type: 'interactive',
  title: 'Projectile Simulator',
  description: 'Explore how launch angle changes projectile motion.',
  keyPoints: ['Adjust angle', 'Observe range'],
  order: 1,
  language: 'en-US',
  widgetType: 'simulation',
  widgetOutline: {
    concept: 'projectile_motion',
    keyVariables: ['angle', 'velocity'],
  },
};

const widgetHtml = `<!DOCTYPE html>
<html>
<head><title>Projectile</title></head>
<body>
  <main id="app">Projectile widget</main>
  <script type="application/json" id="widget-config">
    {"type":"simulation","concept":"Projectile motion","description":"Explore range","variables":[{"name":"angle","label":"Angle","min":0,"max":90,"default":45}]}
  </script>
</body>
</html>`;

describe('Deep Interactive generation', () => {
  it('loads the interactive outline prompt template', () => {
    const prompt = buildPrompt(PROMPT_IDS.INTERACTIVE_OUTLINES, {
      requirement: 'Teach gravity',
      pdfContent: 'None',
      availableImages: 'No images available',
      researchContext: 'None',
      teacherContext: '',
      userProfile: '',
    });

    expect(prompt?.system).toContain('interactive-first');
    expect(prompt?.user).toContain('Widget Type Constraints');
  });

  it('uses widget outline metadata instead of falling back to slides', () => {
    expect(applyOutlineFallbacks(widgetOutline, true).type).toBe('interactive');
    expect(
      applyOutlineFallbacks(
        {
          id: 'missing-config',
          type: 'interactive',
          title: 'Missing config',
          description: 'No widget fields',
          keyPoints: [],
          order: 1,
        },
        true,
      ).type,
    ).toBe('slide');
  });

  it('selects the interactive outline prompt when interactiveMode is enabled', async () => {
    const aiCall = vi.fn(async (_system: string, _user: string) =>
      JSON.stringify({
        languageDirective: 'Teach in English.',
        outlines: [widgetOutline],
      }),
    );

    const result = await generateSceneOutlinesFromRequirements(
      {
        requirement: 'Teach projectile motion with a hands-on simulator',
        language: 'en-US',
        interactiveMode: true,
      },
      undefined,
      undefined,
      aiCall,
    );

    expect(result.success).toBe(true);
    expect(aiCall.mock.calls[0][0]).toContain('interactive-first');
    expect(result.data?.outlines[0]).toMatchObject({
      type: 'interactive',
      widgetType: 'simulation',
      language: 'en-US',
    });
  });

  it('generates widget HTML, extracts widget config, and converts teacher actions', async () => {
    const aiCall = vi.fn(async (_system: string, user: string) => {
      if (user.includes('Create a simulation widget')) {
        return widgetHtml;
      }
      if (user.includes('Generate teacher actions')) {
        return JSON.stringify({
          actions: [
            {
              id: 'teacher-1',
              type: 'highlight',
              target: '#angle-slider',
              content: 'Start by changing the launch angle.',
              label: 'Angle',
            },
            {
              id: 'teacher-2',
              type: 'setState',
              state: { angle: 60 },
              label: 'Steeper',
            },
          ],
        });
      }
      throw new Error(`Unexpected prompt: ${user.slice(0, 80)}`);
    });

    const content = (await generateSceneContent(widgetOutline, aiCall, {
      adaptivePrompt: 'Keep examples concise.',
      languageDirective: 'Teach in English with supportive wording.',
    })) as GeneratedInteractiveContent;

    expect(content.widgetType).toBe('simulation');
    expect(content.widgetConfig).toMatchObject({
      type: 'simulation',
      concept: 'Projectile motion',
    });
    expect(content.teacherActions).toHaveLength(2);
    expect(aiCall.mock.calls[0][0]).toContain('Keep examples concise.');
    expect(aiCall.mock.calls[0][1]).toContain('Teach in English with supportive wording.');
    expect(aiCall.mock.calls[1][0]).toContain('Keep examples concise.');
    expect(aiCall.mock.calls[1][1]).toContain('Teach in English with supportive wording.');

    const actions = await generateSceneActions(widgetOutline, content, async () => '[]');
    expect(actions.map((action) => action.type)).toEqual([
      'widget_highlight',
      'speech',
      'widget_setState',
    ]);

    const scene = buildCompleteScene(widgetOutline, content, actions, 'stage-1');
    expect(scene?.content).toMatchObject({
      type: 'interactive',
      widgetType: 'simulation',
      widgetConfig: { type: 'simulation' },
      teacherActions: content.teacherActions,
    });
  });

  it('keeps legacy interactiveConfig generation working without widget fields', async () => {
    const legacyOutline: SceneOutline = {
      id: 'legacy-interactive',
      type: 'interactive',
      title: 'Legacy Simulator',
      description: 'Legacy scientific model flow.',
      keyPoints: ['One concept'],
      order: 1,
      language: 'en-US',
      interactiveConfig: {
        conceptName: 'Gravity',
        conceptOverview: 'Objects attract each other.',
        designIdea: 'Show two masses attracting.',
      },
    };
    const aiCall = vi.fn(async (_system: string, user: string) => {
      if (user.includes('Please perform scientific modeling')) {
        return JSON.stringify({
          core_formulas: ['F = Gm1m2/r^2'],
          mechanism: ['Masses attract'],
          constraints: ['Keep force non-negative'],
          forbidden_errors: [],
        });
      }
      return '<!DOCTYPE html><html><head></head><body>Legacy widget</body></html>';
    });

    const content = await generateSceneContent(legacyOutline, aiCall, {
      languageDirective: 'Teach in English.',
    });

    expect(content).toMatchObject({ html: expect.stringContaining('Legacy widget') });
    expect((content as GeneratedInteractiveContent).widgetType).toBeUndefined();
  });
});

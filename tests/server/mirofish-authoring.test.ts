import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('MiroFish authoring helpers', () => {
  const originalEnv = {
    MIROFISH_BASE_URL: process.env.MIROFISH_BASE_URL,
    MIROFISH_API_BASE_URL: process.env.MIROFISH_API_BASE_URL,
    MIROFISH_API_KEY: process.env.MIROFISH_API_KEY,
    MIROFISH_AUTHORING_ENABLED: process.env.MIROFISH_AUTHORING_ENABLED,
    MIROFISH_MULTI_USER_ENABLED: process.env.MIROFISH_MULTI_USER_ENABLED,
  };

  beforeEach(() => {
    vi.resetModules();
    process.env.MIROFISH_BASE_URL = 'https://mirofish.example';
    process.env.MIROFISH_API_BASE_URL = 'https://mirofish.example/api';
    process.env.MIROFISH_API_KEY = 'mirofish-api-key';
    process.env.MIROFISH_AUTHORING_ENABLED = 'true';
    process.env.MIROFISH_MULTI_USER_ENABLED = 'false';
  });

  afterEach(() => {
    process.env.MIROFISH_BASE_URL = originalEnv.MIROFISH_BASE_URL;
    process.env.MIROFISH_API_BASE_URL = originalEnv.MIROFISH_API_BASE_URL;
    process.env.MIROFISH_API_KEY = originalEnv.MIROFISH_API_KEY;
    process.env.MIROFISH_AUTHORING_ENABLED = originalEnv.MIROFISH_AUTHORING_ENABLED;
    process.env.MIROFISH_MULTI_USER_ENABLED = originalEnv.MIROFISH_MULTI_USER_ENABLED;
    vi.restoreAllMocks();
  });

  it('reports authoring as not ready when the deployment lacks a valid base config', async () => {
    delete process.env.MIROFISH_BASE_URL;

    const { getMiroFishAuthoringReadiness } = await import('@/lib/server/mirofish-authoring');

    expect(getMiroFishAuthoringReadiness()).toEqual({
      authoringEnabled: true,
      authoringReady: false,
    });
  });

  it('normalizes AI output into a creation spec and preserves the requested contract', async () => {
    const { generateMiroFishCreationSpec } = await import('@/lib/server/mirofish-authoring');

    const aiCall = vi.fn(async () => `\`\`\`json
{
  "title": "Tide Pool Investigation",
  "brief": "ignored by parser",
  "goal": "ignored by parser",
  "activityType": "workspace",
  "targetAudience": "ignored by parser",
  "includeReport": true,
  "defaultSurface": "lesson",
  "collaborationMode": "multi-user",
  "teacherInstructions": ["Launch the simulation", "Ask students to compare outcomes", "Pause for a prediction before the second run"],
  "studentTasks": ["Change the salinity", "Record the species response", "Compare two conditions"],
  "successChecks": ["Students explain the observed pattern", "Students compare at least two conditions"],
  "reportFocus": ["Summarize the pattern"],
  "authoringNotes": "Keep the setup compact."
}
\`\`\``);

    const result = await generateMiroFishCreationSpec({
      goal: 'Build a short tide pool investigation about salinity and species response.',
      activityType: 'investigation',
      targetAudience: 'Grade 8 science',
      includeReport: false,
      defaultSurface: 'simulation',
      collaborationMode: 'single-controller',
      stageName: 'Marine Biology Lab',
      sceneContext: {
        sceneId: 'scene-1',
        sceneTitle: 'Salinity intro',
        sceneType: 'interactive',
        teacherControls: ['Manual advance available'],
        misconceptionHooks: ['Students may confuse salinity and acidity'],
        assessmentPolicy: 'Reveal answers: teacher; next gate: manual',
      },
      aiCall,
    });

    expect(aiCall).toHaveBeenCalledTimes(1);
    expect(result.promptPreview).toContain('Stage: Marine Biology Lab');
    expect(result.promptPreview).toContain('Activity type: investigation');
    expect(result.spec).toEqual(
      expect.objectContaining({
        title: 'Tide Pool Investigation',
        brief: 'Build a short tide pool investigation about salinity and species response.',
        goal: 'Build a short tide pool investigation about salinity and species response.',
        activityType: 'investigation',
        targetAudience: 'Grade 8 science',
        includeReport: false,
        defaultSurface: 'simulation',
        collaborationMode: 'single-controller',
        reportFocus: [],
        authoringNotes: 'Keep the setup compact.',
        sceneContext: expect.objectContaining({
          sceneId: 'scene-1',
          sceneTitle: 'Salinity intro',
        }),
      }),
    );
  });

  it('builds a stable failure message and compact brief preview', async () => {
    const {
      buildMiroFishCreationBriefPreview,
      buildMiroFishCreationFailureMessage,
    } = await import('@/lib/server/mirofish-authoring');

    expect(
      buildMiroFishCreationFailureMessage({
        result: {
          status: 'failed',
          error: 'Wrapper publish timed out',
        },
      }),
    ).toBe('Wrapper publish timed out');
    expect(
      buildMiroFishCreationFailureMessage({
        result: {
          status: 'failed',
        },
        fallbackMessage: 'Authoring failed',
      }),
    ).toBe('Authoring failed');
    expect(
      buildMiroFishCreationBriefPreview(
        'Create a detailed, teacher-reviewed ecosystem simulation that helps students compare salinity, temperature, and population effects across multiple conditions, justify their predictions, document the strongest counterexample they find, and summarize how the environment changes the outcome over several iterative trials.',
      ),
    ).toMatch(/\.\.\.$/);
  });
});

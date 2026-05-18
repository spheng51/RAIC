// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassroomLessonState } from '@/lib/classroom/lesson-state';

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'classroom.lesson.progressAria': 'Lesson progress',
        'classroom.lesson.stagesAria': 'Lesson stages',
        'classroom.lesson.goalLabel': 'Learning goal',
        'classroom.lesson.sceneProgress': `Scene ${options?.current} of ${options?.total}`,
        'classroom.lesson.pdfDocument': 'document',
        'classroom.lesson.pdfAttached': `PDF: ${options?.name}`,
        'classroom.lesson.pdfMissing': 'No PDF',
        'classroom.lesson.webAvailable': 'Web search available',
        'classroom.lesson.webDisabled': 'Web search off',
        'classroom.lesson.sourceMode.pdf-web': 'Sources: PDF + Web',
        'classroom.lesson.languageLabel': `Language: ${options?.language}`,
        'classroom.lesson.modelLabel': `Model: ${options?.model}`,
        'classroom.lesson.stages.intro': 'Introduction',
        'classroom.lesson.stages.explain': 'Explanation',
        'classroom.lesson.stages.example': 'Example',
        'classroom.lesson.stages.practice': 'Practice',
        'classroom.lesson.stages.check': 'Check',
        'classroom.lesson.stages.recap': 'Recap',
      };
      return labels[key] ?? key;
    },
  }),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function buildLessonState(overrides: Partial<ClassroomLessonState> = {}): ClassroomLessonState {
  return {
    goal: 'Learn conservation of energy',
    currentStage: 'example',
    completedStages: ['intro', 'explain'],
    learnerLevel: 'unknown',
    sourceContext: {
      pdfAttached: true,
      pdfName: 'energy-notes.pdf',
      tavilyEnabled: true,
      sourceMode: 'pdf-web',
      language: 'en-US',
      selectedModel: 'openai:gpt-5.1',
    },
    ...overrides,
  };
}

async function mountPanel(lessonState = buildLessonState()) {
  const { LessonFlowPanel } = await import('@/components/stage/lesson-flow-panel');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(
      createElement(LessonFlowPanel, {
        lessonState,
        currentSceneTitle: 'Worked example',
        currentSceneNumber: 3,
        totalScenesCount: 6,
      }),
    );
  });

  return container;
}

describe('LessonFlowPanel', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) continue;

      await act(async () => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
  });

  it('renders the lesson goal, source context, and current stage accessibly', async () => {
    const container = await mountPanel();

    expect(container.textContent).toContain('Learn conservation of energy');
    expect(container.textContent).toContain('Sources: PDF + Web');
    expect(container.textContent).toContain('PDF: energy-notes.pdf');
    expect(container.textContent).toContain('Web search available');
    expect(container.textContent).toContain('Language: English');
    expect(container.textContent).toContain('Model: openai:gpt-5.1');

    const panel = container.querySelector('[aria-label="Lesson progress"]');
    expect(panel).toBeTruthy();
    const currentStep = container.querySelector('[aria-current="step"]');
    expect(currentStep?.textContent).toContain('Example');
  });
});

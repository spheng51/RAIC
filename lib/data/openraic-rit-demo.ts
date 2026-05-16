import { createDefaultSlideContent } from '@/lib/api/stage-api-defaults';
import type { StageStoreData } from '@/lib/utils/stage-storage';
import type { PPTTextElement, Slide } from '@/lib/types/slides';
import type { Scene } from '@/lib/types/stage';

export const EXAMPLE_COURSE_ID = 'openraic-rit-diff-by-band';
export const EXAMPLE_COURSE_SEED_VERSION = 1;

function buildTextElement(options: {
  readonly id: string;
  readonly content: string;
  readonly top: number;
  readonly left?: number;
  readonly width?: number;
  readonly height?: number;
  readonly textType?: 'title' | 'subtitle' | 'content' | 'header';
}): PPTTextElement {
  return {
    type: 'text',
    id: options.id,
    content: options.content,
    left: options.left ?? 40,
    top: options.top,
    width: options.width ?? 920,
    height: options.height ?? 120,
    rotate: 0,
    textType: options.textType,
    defaultFontName: 'Microsoft YaHei',
    defaultColor: '#1f2937',
  };
}

function makeSlideCanvas(override: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly secondary?: string;
}) {
  const template = createDefaultSlideContent();
  const canvas = template.canvas as Slide;
  const slide = {
    ...canvas,
    id: override.id,
    elements: [
      buildTextElement({
        id: `${override.id}-title`,
        textType: 'title',
        content: override.title,
        top: 56,
      }),
      buildTextElement({
        id: `${override.id}-body`,
        textType: 'content',
        top: 180,
        height: 420,
        content: override.body,
      }),
    ],
  } as Slide;

  if (override.secondary) {
    slide.elements.push(
      buildTextElement({
        id: `${override.id}-secondary`,
        textType: 'content',
        top: 410,
        height: 170,
        content: override.secondary,
      }),
    );
  }

  return slide;
}

const EXAMPLE_SCENES: Scene[] = [
  {
    id: 'openraic-rit-demo-scene-intro',
    stageId: EXAMPLE_COURSE_ID,
    type: 'slide',
    title: 'RIT Input + Grouping Strategy',
    order: 0,
    content: {
      type: 'slide',
      canvas: makeSlideCanvas({
        id: 'openraic-rit-demo-slide-intro',
        title: 'Open-RAIC Example: Student-by-Student RIT Support',
        body: `<p><strong>Input shape</strong> (example JSON)</p><pre>{"students":[{"student_id":"a12","name":"Alex","rit":178},{"student_id":"b77","name":"Bri","rit":214},{"student_id":"c09","name":"Kai","rit":236}]}</pre><p><strong>Bands</strong></p><ul><li>Band A: 0-189</li><li>Band B: 190-219</li><li>Band C: 220+</li></ul><p><strong>Differentiated prompts</strong></p><ul><li>Band A: one worked example + one checkpoint check-in</li><li>Band B: varied practice + one verbal explanation request</li><li>Band C: open-ended scenario + one creative extension</li></ul>`,
        secondary: `<p><strong>Why this is useful:</strong> the classroom keeps the same lesson goal while adapting prompt support by readiness.</p>`,
      }),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'openraic-rit-demo-scene-prompts',
    stageId: EXAMPLE_COURSE_ID,
    type: 'slide',
    title: 'Differentiated prompt examples',
    order: 1,
    content: {
      type: 'slide',
      canvas: makeSlideCanvas({
        id: 'openraic-rit-demo-slide-prompts',
        title: 'How prompts can adapt by band',
        body: `<p><strong>Band A (support)</strong>: "Use simpler examples with one new concept, add a worked example, and ask one check question after every step."</p><p><strong>Band B (on track)</strong>: "Use varied problems and ask for one verbal explanation before each final answer."</p><p><strong>Band C (extension)</strong>: "Give a real-life problem, then challenge with one creative extension question or multiple-step plan."</p>`,
      }),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'openraic-rit-demo-scene-start',
    stageId: EXAMPLE_COURSE_ID,
    type: 'slide',
    title: 'Try it in class',
    order: 2,
    content: {
      type: 'slide',
      canvas: makeSlideCanvas({
        id: 'openraic-rit-demo-slide-start',
        title: 'Try the flow',
        body: '<p>Add your own MAP RIT list, swap the band thresholds, then ask for student-specific revision plans.</p>',
      }),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

export function buildOpenRaicRitDemoCoursePayload(timestamp?: number): StageStoreData {
  const now = timestamp ?? Date.now();
  return {
    stage: {
      id: EXAMPLE_COURSE_ID,
      name: 'Public Demo: RIT Differentiation',
      description:
        'This is a public demo course showing how Open-RAIC supports student-by-student differentiation from NWEA MAP RIT scores.',
      createdAt: now,
      updatedAt: now,
      learningGoal:
        'Demonstrate how teacher prompts can be adapted for small RIT bands while keeping the same learning target.',
      language: 'en-US',
      languageDirective: 'Use short, concrete examples and avoid overloading learners.',
      style: 'professional',
      sourceContext: {
        pdfAttached: false,
        tavilyEnabled: false,
        language: 'en-US',
        selectedModel: 'openraic-demo',
        creationMode: 'course',
      },
    },
    scenes: EXAMPLE_SCENES.map((scene) => ({
      ...scene,
      createdAt: now,
      updatedAt: now,
      stageId: EXAMPLE_COURSE_ID,
    })),
    currentSceneId: 'openraic-rit-demo-scene-intro',
    chats: [],
  };
}

export const OPENRAIC_RIT_DEMO_SCENES = EXAMPLE_SCENES;

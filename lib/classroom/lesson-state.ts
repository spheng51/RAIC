import { deriveClassroomSourceMode } from '@/lib/classroom/source-context';
import type { ClassroomSourceMode, Scene, Stage } from '@/lib/types/stage';

export const LESSON_STAGE_IDS = [
  'intro',
  'explain',
  'example',
  'practice',
  'check',
  'recap',
] as const;

export type LessonStageId = (typeof LESSON_STAGE_IDS)[number];
export type LearnerLevel = 'unknown' | 'beginner' | 'intermediate' | 'advanced';

export interface ClassroomLessonSourceContext {
  pdfAttached: boolean;
  pdfName?: string;
  tavilyEnabled: boolean;
  sourceMode: ClassroomSourceMode;
  language: string;
  selectedModel: string;
}

export interface ClassroomLessonState {
  goal: string;
  currentStage: LessonStageId;
  completedStages: LessonStageId[];
  learnerLevel: LearnerLevel;
  sourceContext: ClassroomLessonSourceContext;
}

export const LESSON_STAGE_LABELS: Record<LessonStageId, string> = {
  intro: 'Introduction',
  explain: 'Explanation',
  example: 'Example',
  practice: 'Practice',
  check: 'Check for understanding',
  recap: 'Recap',
};

const DEFAULT_GOAL = 'Untitled lesson';
const DEFAULT_LANGUAGE = 'en-US';
const DEFAULT_MODEL = 'current classroom model';

function normalizeGoal(stage: Stage | null | undefined): string {
  const goal = stage?.learningGoal?.trim() || stage?.description?.trim() || stage?.name?.trim();
  return goal || DEFAULT_GOAL;
}

function stageFromSceneTitle(scene: Scene | null | undefined): LessonStageId | null {
  const title = `${scene?.title ?? ''} ${scene?.type ?? ''}`.toLowerCase();

  if (/recap|summary|wrap|review|next step/.test(title)) {
    return 'recap';
  }
  if (/quiz|check|understanding|assessment|test/.test(title)) {
    return 'check';
  }
  if (/practice|exercise|activity|lab|project|pbl|interactive|try/.test(title)) {
    return 'practice';
  }
  if (/example|demo|case|walkthrough/.test(title)) {
    return 'example';
  }
  if (/intro|overview|welcome|orientation/.test(title)) {
    return 'intro';
  }

  return null;
}

export function inferLessonStage(input: {
  scenes: Scene[];
  currentSceneId: string | null;
}): LessonStageId {
  const { scenes, currentSceneId } = input;
  if (scenes.length === 0 || !currentSceneId) {
    return 'intro';
  }

  const orderedScenes = [...scenes].sort((a, b) => a.order - b.order);
  const currentIndex = orderedScenes.findIndex((scene) => scene.id === currentSceneId);
  const currentScene = currentIndex >= 0 ? orderedScenes[currentIndex] : null;
  const titleStage = stageFromSceneTitle(currentScene);
  if (titleStage) {
    return titleStage;
  }

  if (currentIndex <= 0) {
    return 'intro';
  }

  const ratio = currentIndex / Math.max(orderedScenes.length - 1, 1);
  if (ratio < 0.22) return 'explain';
  if (ratio < 0.45) return 'example';
  if (ratio < 0.7) return 'practice';
  if (ratio < 0.9) return 'check';
  return 'recap';
}

export function buildClassroomLessonState(input: {
  stage: Stage | null | undefined;
  scenes: Scene[];
  currentSceneId: string | null;
  selectedModelFallback?: string | null;
}): ClassroomLessonState {
  const currentStage = inferLessonStage({
    scenes: input.scenes,
    currentSceneId: input.currentSceneId,
  });
  const stageIndex = LESSON_STAGE_IDS.indexOf(currentStage);
  const sourceContext = input.stage?.sourceContext;
  const pdfName = sourceContext?.pdfName?.trim();
  const pdfAttached = Boolean(sourceContext?.pdfAttached || pdfName);
  const tavilyEnabled = Boolean(sourceContext?.tavilyEnabled);

  return {
    goal: normalizeGoal(input.stage),
    currentStage,
    completedStages: LESSON_STAGE_IDS.slice(0, Math.max(stageIndex, 0)),
    learnerLevel: 'unknown',
    sourceContext: {
      pdfAttached,
      ...(pdfName ? { pdfName } : {}),
      tavilyEnabled,
      sourceMode:
        sourceContext?.sourceMode ?? deriveClassroomSourceMode({ pdfAttached, tavilyEnabled }),
      language: sourceContext?.language || input.stage?.language || DEFAULT_LANGUAGE,
      selectedModel: sourceContext?.selectedModel || input.selectedModelFallback || DEFAULT_MODEL,
    },
  };
}

const SOURCE_MODE_LABELS: Record<ClassroomSourceMode, string> = {
  none: 'none',
  pdf: 'PDF',
  web: 'web search',
  'pdf-web': 'PDF and web search',
};

export function buildClassroomTutorSystemPrompt(lessonState: ClassroomLessonState): string {
  const { goal, currentStage, sourceContext } = lessonState;
  const pdfLine = sourceContext.pdfAttached
    ? `- A learner-provided PDF is available${sourceContext.pdfName ? `: ${sourceContext.pdfName}` : ''}. Reference it only when the classroom context actually contains relevant document content.`
    : '- No learner PDF is attached. Do not claim to have read a document.';
  const webLine = sourceContext.tavilyEnabled
    ? '- Tavily/web search was enabled for generation. Use current or external information only when it genuinely helps; do not overuse search for basic tutoring.'
    : '- Web search is disabled. Do not imply that current external information was checked.';

  return `## Interactive Tutor Lesson Contract
Learning goal: ${goal}
Current lesson stage: ${LESSON_STAGE_LABELS[currentStage]}
Language: ${sourceContext.language}
Model context: ${sourceContext.selectedModel}

Source boundaries:
- Source mode: ${SOURCE_MODE_LABELS[sourceContext.sourceMode]}.
${pdfLine}
${webLine}

Teaching behavior:
- Start by briefly confirming the learner's goal before teaching new material.
- Ask one short diagnostic question when it would help calibrate the learner's level.
- Teach in small chunks. Avoid a giant lecture.
- Explain step by step, using examples before abstract generalization when helpful.
- Use the whiteboard for key terms, diagrams, formulas, tables, step-by-step reasoning, examples, or practice prompts when the topic benefits from structure.
- Check understanding before moving to a harder idea.
- Adapt to short learner intents: "I don't get it" means simplify and use a new example; "harder" means increase challenge; "easier" means reduce difficulty; "quiz me" means ask one focused question; "give me an example" means provide one concrete worked example.
- End substantial turns with either a quick check, a practice task, or a recap plus one next step.
- Keep the classroom interactive and humane: one idea at a time, then invite the learner back in.`;
}

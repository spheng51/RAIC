/**
 * Stage 1: Generate scene outlines from user requirements.
 * Also contains outline fallback logic.
 */

import { nanoid } from 'nanoid';
import { MAX_PDF_CONTENT_CHARS, MAX_VISION_IMAGES } from '@/lib/constants/generation';
import type {
  UserRequirements,
  SceneOutline,
  PdfImage,
  ImageMapping,
} from '@/lib/types/generation';
import { buildPrompt, PROMPT_IDS } from './prompts';
import { formatImageDescription, formatImagePlaceholder } from './prompt-formatters';
import { parseJsonResponse } from './json-repair';
import { uniquifyMediaElementIds } from './scene-builder';
import type { AICallFn, GenerationResult, GenerationCallbacks } from './pipeline-types';
import { formatGameTemplateForPrompt } from '@/lib/game-arcade/templates';
import { buildCourseLanguageDirective } from './language-directive';
export { DEFAULT_LANGUAGE_DIRECTIVE, buildCourseLanguageDirective } from './language-directive';
import { createLogger } from '@/lib/logger';
const log = createLogger('Generation');

export function enrichGeneratedOutline(
  outline: SceneOutline,
  index: number,
  requirements: UserRequirements,
): SceneOutline {
  const enriched: SceneOutline = {
    ...outline,
    id: outline.id || nanoid(),
    order: index + 1,
    language: requirements.language,
  };

  if (requirements.creationMode !== 'game-arcade' || enriched.type !== 'interactive') {
    return enriched;
  }

  const widgetOutline = enriched.widgetOutline ?? {};
  return {
    ...enriched,
    widgetType: 'game',
    widgetOutline: {
      ...widgetOutline,
      gameTemplateId: widgetOutline.gameTemplateId ?? requirements.gameTemplateId,
      gameGoal:
        widgetOutline.gameGoal ??
        widgetOutline.challenge ??
        requirements.gameCreativeBrief ??
        requirements.requirement,
      coreMechanic:
        widgetOutline.coreMechanic ?? widgetOutline.challenge ?? 'Playable classroom game',
      difficultyCurve: widgetOutline.difficultyCurve ?? 'standard',
    },
  };
}

/**
 * Generate scene outlines from user requirements
 * Now uses simplified UserRequirements with just requirement text and language
 */
export async function generateSceneOutlinesFromRequirements(
  requirements: UserRequirements,
  pdfText: string | undefined,
  pdfImages: PdfImage[] | undefined,
  aiCall: AICallFn,
  callbacks?: GenerationCallbacks,
  options?: {
    visionEnabled?: boolean;
    imageMapping?: ImageMapping;
    imageGenerationEnabled?: boolean;
    videoGenerationEnabled?: boolean;
    researchContext?: string;
    teacherContext?: string;
  },
): Promise<GenerationResult<{ languageDirective: string; outlines: SceneOutline[] }>> {
  // Build available images description for the prompt
  let availableImagesText =
    requirements.language === 'zh-CN' ? '无可用图片' : 'No images available';
  let visionImages: Array<{ id: string; src: string }> | undefined;

  if (pdfImages && pdfImages.length > 0) {
    if (options?.visionEnabled && options?.imageMapping) {
      // Vision mode: split into vision images (first N) and text-only (rest)
      const allWithSrc = pdfImages.filter((img) => options.imageMapping![img.id]);
      const visionSlice = allWithSrc.slice(0, MAX_VISION_IMAGES);
      const textOnlySlice = allWithSrc.slice(MAX_VISION_IMAGES);
      const noSrcImages = pdfImages.filter((img) => !options.imageMapping![img.id]);

      const visionDescriptions = visionSlice.map((img) =>
        formatImagePlaceholder(img, requirements.language),
      );
      const textDescriptions = [...textOnlySlice, ...noSrcImages].map((img) =>
        formatImageDescription(img, requirements.language),
      );
      availableImagesText = [...visionDescriptions, ...textDescriptions].join('\n');

      visionImages = visionSlice.map((img) => ({
        id: img.id,
        src: options.imageMapping![img.id],
        width: img.width,
        height: img.height,
      }));
    } else {
      // Text-only mode: full descriptions
      availableImagesText = pdfImages
        .map((img) => formatImageDescription(img, requirements.language))
        .join('\n');
    }
  }

  // Build user profile string for prompt injection
  const userProfileText =
    requirements.userNickname || requirements.userBio
      ? `## Student Profile\n\nStudent: ${requirements.userNickname || 'Unknown'}${requirements.userBio ? ` — ${requirements.userBio}` : ''}\n\nConsider this student's background when designing the course. Adapt difficulty, examples, and teaching approach accordingly.\n\n---`
      : '';

  // Build media snippet conditions based on enabled flags. Disabled media
  // capabilities are omitted from prompts instead of described negatively.
  const imageEnabled = options?.imageGenerationEnabled ?? false;
  const videoEnabled = options?.videoGenerationEnabled ?? false;
  const mediaEnabled = imageEnabled || videoEnabled;
  const hasSourceImages = (pdfImages?.length ?? 0) > 0;
  const languageDirective = buildCourseLanguageDirective(requirements.language);

  // Game Arcade has the strongest prompt shape; Deep Interactive is the generic widget-first mode.
  const outlinePromptId =
    requirements.creationMode === 'game-arcade'
      ? PROMPT_IDS.GAME_ARCADE_OUTLINES
      : requirements.interactiveMode
        ? PROMPT_IDS.INTERACTIVE_OUTLINES
        : PROMPT_IDS.REQUIREMENTS_TO_OUTLINES;
  const prompts = buildPrompt(outlinePromptId, {
    // New simplified variables
    requirement: requirements.requirement,
    language: requirements.language,
    pdfContent: pdfText
      ? pdfText.substring(0, MAX_PDF_CONTENT_CHARS)
      : requirements.language === 'zh-CN'
        ? '无'
        : 'None',
    availableImages: availableImagesText,
    userProfile: userProfileText,
    hasSourceImages,
    imageEnabled,
    videoEnabled,
    mediaEnabled,
    researchContext:
      options?.researchContext || (requirements.language === 'zh-CN' ? '无' : 'None'),
    // Server-side generation populates this via options; client-side populates via formatTeacherPersonaForPrompt
    teacherContext: options?.teacherContext || '',
    languageDirective,
    gameTemplateContext: formatGameTemplateForPrompt(requirements.gameTemplateId),
    gameCreativeBrief: requirements.gameCreativeBrief || requirements.requirement,
  });

  if (!prompts) {
    return { success: false, error: 'Prompt template not found' };
  }

  try {
    callbacks?.onProgress?.({
      currentStage: 1,
      overallProgress: 20,
      stageProgress: 50,
      statusMessage: '正在分析需求，生成场景大纲...',
      scenesGenerated: 0,
      totalScenes: 0,
    });

    const response = await aiCall(prompts.system, prompts.user, visionImages);
    const parsed = parseJsonResponse<
      { languageDirective?: string; outlines?: SceneOutline[] } | SceneOutline[]
    >(response);

    let outlines: SceneOutline[];

    if (Array.isArray(parsed)) {
      outlines = parsed;
    } else if (parsed && Array.isArray(parsed.outlines)) {
      outlines = parsed.outlines;
    } else {
      return {
        success: false,
        error: 'Failed to parse scene outlines response',
      };
    }

    if (!outlines || !Array.isArray(outlines)) {
      return {
        success: false,
        error: 'Failed to parse scene outlines response',
      };
    }
    // Ensure IDs, order, and language
    const enriched = outlines.map((outline, index) =>
      enrichGeneratedOutline(outline, index, requirements),
    );

    // Replace sequential gen_img_N/gen_vid_N with globally unique IDs
    const result = uniquifyMediaElementIds(enriched);

    callbacks?.onProgress?.({
      currentStage: 1,
      overallProgress: 50,
      stageProgress: 100,
      statusMessage: `已生成 ${result.length} 个场景大纲`,
      scenesGenerated: 0,
      totalScenes: result.length,
    });

    return { success: true, data: { languageDirective, outlines: result } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Apply type fallbacks for outlines that can't be generated as their declared type.
 * - interactive without either legacy interactiveConfig or widget metadata → slide
 * - pbl without pblConfig or languageModel → slide
 */
export function applyOutlineFallbacks(
  outline: SceneOutline,
  hasLanguageModel: boolean,
): SceneOutline {
  const hasWidgetMetadata = Boolean(outline.widgetType && outline.widgetOutline);
  if (outline.type === 'interactive' && !outline.interactiveConfig && !hasWidgetMetadata) {
    log.warn(
      `Interactive outline "${outline.title}" missing interactive config, falling back to slide`,
    );
    return { ...outline, type: 'slide' };
  }
  if (outline.type === 'pbl' && (!outline.pblConfig || !hasLanguageModel)) {
    log.warn(
      `PBL outline "${outline.title}" missing pblConfig or languageModel, falling back to slide`,
    );
    return { ...outline, type: 'slide' };
  }
  return outline;
}

import { nanoid } from 'nanoid';
import { callLLM } from '@/lib/ai/llm';
import { createStageAPI } from '@/lib/api/stage-api';
import type { StageStore } from '@/lib/api/stage-api-types';
import {
  applyOutlineFallbacks,
  generateSceneOutlinesFromRequirements,
} from '@/lib/generation/outline-generator';
import { generateSingleSceneOutcome } from '@/lib/generation/scene-generator';
import { executeScenesWithPolicy } from '@/lib/generation/scene-executor';
import type { AICallFn } from '@/lib/generation/pipeline-types';
import type { AgentInfo } from '@/lib/generation/pipeline-types';
import { formatTeacherPersonaForPrompt } from '@/lib/generation/prompt-formatters';
import { getDefaultAgents } from '@/lib/orchestration/registry/store';
import { createLogger } from '@/lib/logger';
import { isProviderKeyRequired } from '@/lib/ai/providers';
import { resolveGovernedProviderConfig } from '@/lib/server/ai-governance';
import { resolveModel } from '@/lib/server/resolve-model';
import { buildSearchQuery } from '@/lib/server/search-query-builder';
import { searchWithTavily, formatSearchResultsAsContext } from '@/lib/web-search/tavily';
import { persistClassroom } from '@/lib/server/classroom-storage';
import {
  generateMediaForClassroom,
  replaceMediaPlaceholders,
  generateTTSForClassroom,
} from '@/lib/server/classroom-media-generation';
import type {
  GenerationCompletionStatus,
  GenerationWarning,
  SceneOutcome,
  UserRequirements,
} from '@/lib/types/generation';
import type { Scene, Stage } from '@/lib/types/stage';
import { AGENT_COLOR_PALETTE, AGENT_DEFAULT_AVATARS } from '@/lib/constants/agent-defaults';

const log = createLogger('Classroom');

export interface ImageProviderOverride {
  providerId: string;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface GenerateClassroomInput {
  requirement: string;
  requestKey?: string;
  pdfContent?: { text: string; images: string[] };
  language?: string;
  enableWebSearch?: boolean;
  enableImageGeneration?: boolean;
  enableVideoGeneration?: boolean;
  enableTTS?: boolean;
  agentMode?: 'default' | 'generate';
  imageProviderOverride?: ImageProviderOverride;
}

export type ClassroomGenerationStep =
  | 'initializing'
  | 'researching'
  | 'generating_outlines'
  | 'generating_scenes'
  | 'generating_media'
  | 'generating_tts'
  | 'persisting'
  | 'completed';

export interface ClassroomGenerationProgress {
  step: ClassroomGenerationStep;
  progress: number;
  message: string;
  scenesGenerated: number;
  scenesFailed?: number;
  totalScenes?: number;
  warnings?: GenerationWarning[];
}

export interface GenerateClassroomResult {
  id: string;
  url: string;
  stage: Stage;
  scenes: Scene[];
  scenesCount: number;
  totalScenes: number;
  completionStatus: Exclude<GenerationCompletionStatus, 'failed'>;
  warnings: GenerationWarning[];
  sceneOutcomes: SceneOutcome[];
  createdAt: string;
}

function createInMemoryStore(stage: Stage): StageStore {
  let state = {
    stage: stage as Stage | null,
    scenes: [] as Scene[],
    currentSceneId: null as string | null,
    mode: 'playback' as const,
  };

  const listeners: Array<(s: typeof state, prev: typeof state) => void> = [];

  return {
    getState: () => state,
    setState: (partial: Partial<typeof state>) => {
      const prev = state;
      state = { ...state, ...partial };
      listeners.forEach((fn) => fn(state, prev));
    },
    subscribe: (listener: (s: typeof state, prev: typeof state) => void) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
}

function normalizeLanguage(language?: string): 'zh-CN' | 'en-US' {
  return language === 'en-US' ? 'en-US' : 'zh-CN';
}

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

async function generateAgentProfiles(
  requirement: string,
  language: string,
  aiCall: AICallFn,
): Promise<AgentInfo[]> {
  const systemPrompt =
    'You are an expert instructional designer. Generate agent profiles for a multi-agent classroom simulation. Return ONLY valid JSON, no markdown or explanation.';

  const userPrompt = `Generate agent profiles for a course with this requirement:
${requirement}

Requirements:
- Decide the appropriate number of agents based on the course content (typically 3-5)
- Exactly 1 agent must have role "teacher", the rest can be "assistant" or "student"
- Each agent needs: name, role, persona (2-3 sentences describing personality and teaching/learning style)
- Names and personas must be in language: ${language}

Return a JSON object with this exact structure:
{
  "agents": [
    {
      "name": "string",
      "role": "teacher" | "assistant" | "student",
      "persona": "string (2-3 sentences)"
    }
  ]
}`;

  const response = await aiCall(systemPrompt, userPrompt);
  const rawText = stripCodeFences(response);
  const parsed = JSON.parse(rawText) as {
    agents: Array<{ name: string; role: string; persona: string }>;
  };

  if (!parsed.agents || !Array.isArray(parsed.agents) || parsed.agents.length < 2) {
    throw new Error(`Expected at least 2 agents, got ${parsed.agents?.length ?? 0}`);
  }

  const teacherCount = parsed.agents.filter((a) => a.role === 'teacher').length;
  if (teacherCount !== 1) {
    throw new Error(`Expected exactly 1 teacher, got ${teacherCount}`);
  }

  return parsed.agents.map((a, i) => ({
    id: `gen-server-${i}`,
    name: a.name,
    role: a.role,
    persona: a.persona,
  }));
}

export async function generateClassroom(
  input: GenerateClassroomInput,
  options: {
    baseUrl: string;
    organizationId?: string | null;
    userId?: string | null;
    onProgress?: (progress: ClassroomGenerationProgress) => Promise<void> | void;
  },
): Promise<GenerateClassroomResult> {
  const { requirement, pdfContent } = input;

  await options.onProgress?.({
    step: 'initializing',
    progress: 5,
    message: 'Initializing classroom generation',
    scenesGenerated: 0,
  });

  const {
    model: languageModel,
    modelInfo,
    modelString,
    providerId,
    apiKey,
  } = await resolveModel({
    organizationId: options.organizationId,
    userId: options.userId,
    mode: 'background',
  });
  log.info(`Using server-configured model: ${modelString}`);

  // Fail fast if the resolved provider has no API key configured
  if (isProviderKeyRequired(providerId) && !apiKey) {
    throw new Error(
      `No API key configured for provider "${providerId}". ` +
        `Set the appropriate key in .env.local or server-providers.yml (e.g. ${providerId.toUpperCase()}_API_KEY).`,
    );
  }

  const aiCall: AICallFn = async (systemPrompt, userPrompt, _images) => {
    const result = await callLLM(
      {
        model: languageModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxOutputTokens: modelInfo?.outputWindow,
      },
      'generate-classroom',
    );
    return result.text;
  };

  const searchQueryAiCall: AICallFn = async (systemPrompt, userPrompt, _images) => {
    const result = await callLLM(
      {
        model: languageModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxOutputTokens: 256,
      },
      'web-search-query-rewrite',
    );
    return result.text;
  };

  const lang = normalizeLanguage(input.language);
  const requirements: UserRequirements = {
    requirement,
    language: lang,
  };
  const pdfText = pdfContent?.text || undefined;

  // Resolve agents based on agentMode
  let agents: AgentInfo[];
  let agentMode = input.agentMode || 'default';
  if (agentMode === 'generate') {
    log.info('Generating custom agent profiles via LLM...');
    try {
      agents = await generateAgentProfiles(requirement, lang, aiCall);
      log.info(`Generated ${agents.length} agent profiles`);
    } catch (e) {
      log.warn('Agent profile generation failed, falling back to defaults:', e);
      agents = getDefaultAgents();
      agentMode = 'default';
    }
  } else {
    agents = getDefaultAgents();
  }
  const teacherContext = formatTeacherPersonaForPrompt(agents);

  await options.onProgress?.({
    step: 'researching',
    progress: 10,
    message: 'Researching topic',
    scenesGenerated: 0,
  });

  // Web search (optional, graceful degradation)
  let researchContext: string | undefined;
  if (input.enableWebSearch) {
    try {
      const resolvedWebSearch = await resolveGovernedProviderConfig({
        auth: null,
        organizationId: options.organizationId,
        family: 'webSearch',
        providerId: 'tavily',
        mode: 'background',
      });

      try {
        const searchQuery = await buildSearchQuery(requirement, pdfText, searchQueryAiCall);

        log.info('Running web search for classroom generation', {
          hasPdfContext: searchQuery.hasPdfContext,
          rawRequirementLength: searchQuery.rawRequirementLength,
          rewriteAttempted: searchQuery.rewriteAttempted,
          finalQueryLength: searchQuery.finalQueryLength,
        });

        const searchResult = await searchWithTavily({
          query: searchQuery.query,
          apiKey: resolvedWebSearch.apiKey,
          baseUrl: resolvedWebSearch.baseUrl,
        });
        researchContext = formatSearchResultsAsContext(searchResult);
        if (researchContext) {
          log.info(`Web search returned ${searchResult.sources.length} sources`);
        }
      } catch (e) {
        log.warn('Web search failed, continuing without search context:', e);
      }
    } catch (e) {
      log.warn(
        'enableWebSearch is true but no governed Tavily configuration is available, skipping web search',
        e,
      );
    }
  }

  await options.onProgress?.({
    step: 'generating_outlines',
    progress: 15,
    message: 'Generating scene outlines',
    scenesGenerated: 0,
  });

  const outlinesResult = await generateSceneOutlinesFromRequirements(
    requirements,
    pdfText,
    undefined,
    aiCall,
    undefined,
    {
      imageGenerationEnabled: input.enableImageGeneration,
      videoGenerationEnabled: input.enableVideoGeneration,
      researchContext,
      teacherContext,
    },
  );

  if (!outlinesResult.success || !outlinesResult.data) {
    log.error('Failed to generate outlines:', outlinesResult.error);
    throw new Error(outlinesResult.error || 'Failed to generate scene outlines');
  }

  const outlines = outlinesResult.data;
  log.info(`Generated ${outlines.length} scene outlines`);

  await options.onProgress?.({
    step: 'generating_outlines',
    progress: 30,
    message: `Generated ${outlines.length} scene outlines`,
    scenesGenerated: 0,
    totalScenes: outlines.length,
  });

  const stageId = nanoid(10);
  const stage: Stage = {
    id: stageId,
    name: outlines[0]?.title || requirement.slice(0, 50),
    description: undefined,
    language: lang,
    style: 'interactive',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    // For LLM-generated agents, embed full configs so the client can
    // hydrate the agent registry without prior IndexedDB data.
    // For default agents, just record IDs — the client already has them.
    ...(agentMode === 'generate'
      ? {
          generatedAgentConfigs: agents.map((a, i) => ({
            id: a.id,
            name: a.name,
            role: a.role,
            persona: a.persona || '',
            avatar: AGENT_DEFAULT_AVATARS[i % AGENT_DEFAULT_AVATARS.length],
            color: AGENT_COLOR_PALETTE[i % AGENT_COLOR_PALETTE.length],
            priority: a.role === 'teacher' ? 10 : a.role === 'assistant' ? 7 : 5,
          })),
        }
      : {
          agentIds: agents.map((a) => a.id),
        }),
  };

  const store = createInMemoryStore(stage);
  const api = createStageAPI(store);
  const safeOutlines = outlines.map((outline) => applyOutlineFallbacks(outline, true));

  log.info('Stage 2: Generating scene content and actions...');
  await options.onProgress?.({
    step: 'generating_scenes',
    progress: 31,
    message: `Generating ${safeOutlines.length} scenes`,
    scenesGenerated: 0,
    scenesFailed: 0,
    totalScenes: safeOutlines.length,
  });

  const sceneSummary = await executeScenesWithPolicy({
    items: safeOutlines.map((outline, index) => ({
      outline,
      index,
      context: {
        api,
        aiCall,
        agents,
      },
    })),
    executeScene: async (item, attempt) =>
      generateSingleSceneOutcome(item.outline, item.index, attempt, item.context!),
    onProgress: async (progress) => {
      await options.onProgress?.({
        step: 'generating_scenes',
        progress: Math.min(
          30 + Math.floor((progress.completedScenes / Math.max(safeOutlines.length, 1)) * 60),
          90,
        ),
        message:
          progress.latestOutcome.status === 'failed'
            ? `Scene ${progress.latestOutcome.index + 1}/${safeOutlines.length} failed: ${progress.latestOutcome.title}`
            : `Generated ${progress.generatedScenes}/${safeOutlines.length} scenes`,
        scenesGenerated: progress.generatedScenes,
        scenesFailed: progress.failedScenes,
        totalScenes: safeOutlines.length,
        warnings: progress.warnings,
      });
    },
  });

  const scenes = store.getState().scenes;
  log.info(`Pipeline complete: ${scenes.length} scenes generated`);

  if (sceneSummary.generatedScenes === 0 || scenes.length === 0) {
    throw new Error('No scenes were generated');
  }

  const warnings: GenerationWarning[] = [...sceneSummary.warnings];

  if (input.enableImageGeneration || input.enableVideoGeneration) {
    await options.onProgress?.({
      step: 'generating_media',
      progress: 90,
      message: 'Generating media files',
      scenesGenerated: scenes.length,
      scenesFailed: sceneSummary.failedScenes,
      totalScenes: safeOutlines.length,
      warnings,
    });

    try {
      const mediaResult = await generateMediaForClassroom(safeOutlines, stageId, options.baseUrl, {
        organizationId: options.organizationId ?? null,
        imageProviderOverride: input.enableImageGeneration
          ? input.imageProviderOverride
          : undefined,
      });
      replaceMediaPlaceholders(scenes, mediaResult.mediaMap);
      warnings.push(...mediaResult.warnings);
      log.info(`Media generation complete: ${Object.keys(mediaResult.mediaMap).length} files`);
    } catch (err) {
      log.warn('Media generation phase failed, continuing:', err);
      warnings.push({
        stage: 'media',
        code: 'media_phase_failed',
        message: 'Media generation phase failed',
        retryable: false,
        attempts: 1,
      });
    }
  }

  if (input.enableTTS) {
    await options.onProgress?.({
      step: 'generating_tts',
      progress: 94,
      message: 'Generating TTS audio',
      scenesGenerated: scenes.length,
      scenesFailed: sceneSummary.failedScenes,
      totalScenes: safeOutlines.length,
      warnings,
    });

    try {
      const ttsWarnings = await generateTTSForClassroom(scenes, stageId, options.baseUrl, {
        organizationId: options.organizationId ?? null,
      });
      warnings.push(...ttsWarnings);
      log.info('TTS generation complete');
    } catch (err) {
      log.warn('TTS generation phase failed, continuing:', err);
      warnings.push({
        stage: 'tts',
        code: 'tts_phase_failed',
        message: 'TTS generation phase failed',
        retryable: false,
        attempts: 1,
      });
    }
  }

  const completionStatus: Exclude<GenerationCompletionStatus, 'failed'> =
    sceneSummary.failedScenes > 0 || warnings.length > 0 ? 'partial' : 'complete';
  stage.generationCompletionStatus = completionStatus;
  stage.generationWarnings = warnings;

  await options.onProgress?.({
    step: 'persisting',
    progress: 98,
    message: 'Persisting classroom data',
    scenesGenerated: scenes.length,
    scenesFailed: sceneSummary.failedScenes,
    totalScenes: safeOutlines.length,
    warnings,
  });

  const persisted = await persistClassroom(
    {
      id: stageId,
      ownerUserId: options.userId ?? null,
      organizationId: options.organizationId ?? null,
      stage,
      scenes,
    },
    options.baseUrl,
  );

  log.info(`Classroom persisted: ${persisted.id}, URL: ${persisted.url}`);

  await options.onProgress?.({
    step: 'completed',
    progress: 100,
    message:
      completionStatus === 'partial'
        ? 'Classroom generation completed with warnings'
        : 'Classroom generation completed',
    scenesGenerated: scenes.length,
    scenesFailed: sceneSummary.failedScenes,
    totalScenes: safeOutlines.length,
    warnings,
  });

  return {
    id: persisted.id,
    url: persisted.url,
    stage,
    scenes,
    scenesCount: scenes.length,
    totalScenes: safeOutlines.length,
    completionStatus,
    warnings,
    sceneOutcomes: sceneSummary.sceneOutcomes,
    createdAt: persisted.createdAt,
  };
}

import 'server-only';

import { jsonrepair } from 'jsonrepair';
import { createLogger } from '@/lib/logger';
import type { AICallFn } from '@/lib/generation/pipeline-types';
import { getMiroFishConfig, isMiroFishMultiUserEnabled } from '@/lib/server/mirofish';
import {
  miroFishAuthoringResultSchema,
  miroFishCreationPlanRequestSchema,
  miroFishCreationSpecSchema,
  type MiroFishAuthoringResult,
  type MiroFishCreationPlanRequest,
  type MiroFishCreationSceneContext,
  type MiroFishCreationSpec,
} from '@/lib/types/mirofish-authoring';

const log = createLogger('MiroFish Authoring');

interface GenerateMiroFishCreationSpecInput extends MiroFishCreationPlanRequest {
  stageName: string;
  sceneContext?: MiroFishCreationSceneContext;
  aiCall: AICallFn;
}

function stripCodeFences(text: string) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

function normalizePreview(text: string) {
  const trimmed = text.trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function parseBooleanEnv(name: string) {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function createAuthoringHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
  };
}

function createAuthoringUrl(relativePath: string) {
  const { apiBaseUrl } = getMiroFishConfig();
  return new URL(relativePath.replace(/^\/+/, ''), `${apiBaseUrl}/`);
}

function normalizeSceneContext(
  sceneContext: MiroFishCreationSceneContext | undefined,
): MiroFishCreationSceneContext | undefined {
  if (!sceneContext) {
    return undefined;
  }

  const teacherControls =
    sceneContext.teacherControls?.filter((value) => value.trim().length > 0) ?? [];
  const misconceptionHooks =
    sceneContext.misconceptionHooks?.filter((value) => value.trim().length > 0) ?? [];

  if (
    !sceneContext.sceneId &&
    !sceneContext.sceneTitle &&
    !sceneContext.sceneType &&
    teacherControls.length === 0 &&
    misconceptionHooks.length === 0 &&
    !sceneContext.assessmentPolicy
  ) {
    return undefined;
  }

  return {
    sceneId: sceneContext.sceneId,
    sceneTitle: sceneContext.sceneTitle,
    sceneType: sceneContext.sceneType,
    teacherControls,
    misconceptionHooks,
    assessmentPolicy: sceneContext.assessmentPolicy,
  };
}

function buildPromptPreview(input: GenerateMiroFishCreationSpecInput) {
  const sceneLabel = input.sceneContext?.sceneTitle
    ? `${input.sceneContext.sceneTitle}${input.sceneContext.sceneType ? ` [${input.sceneContext.sceneType}]` : ''}`
    : 'No specific scene selected';

  return [
    `Stage: ${input.stageName}`,
    `Goal: ${input.goal}`,
    `Activity type: ${input.activityType}`,
    `Target audience: ${input.targetAudience}`,
    `Scene: ${sceneLabel}`,
    `Include report: ${input.includeReport ? 'yes' : 'no'}`,
    `Default surface: ${input.defaultSurface}`,
    `Collaboration mode: ${input.collaborationMode}`,
  ].join('\n');
}

export function isMiroFishAuthoringEnabled() {
  return parseBooleanEnv('MIROFISH_AUTHORING_ENABLED');
}

export function getMiroFishAuthoringReadiness() {
  const enabled = isMiroFishAuthoringEnabled();
  if (!enabled) {
    return {
      authoringEnabled: false,
      authoringReady: false,
    };
  }

  try {
    const { apiKey } = getMiroFishConfig();
    return {
      authoringEnabled: true,
      authoringReady: Boolean(apiKey),
    };
  } catch {
    return {
      authoringEnabled: true,
      authoringReady: false,
    };
  }
}

export function assertMiroFishAuthoringAvailable() {
  if (!isMiroFishAuthoringEnabled()) {
    throw new Error('MiroFish AI-guided creation is disabled for this deployment');
  }

  const { apiKey } = getMiroFishConfig();
  if (!apiKey) {
    throw new Error('MIROFISH_API_KEY is required when MiroFish authoring is enabled');
  }
}

export function buildMiroFishCreationPrompt(input: GenerateMiroFishCreationSpecInput) {
  const sceneContext = normalizeSceneContext(input.sceneContext);
  const promptPreview = buildPromptPreview({ ...input, sceneContext });
  const sceneContextBlock = sceneContext
    ? `Scene context:
${JSON.stringify(sceneContext, null, 2)}`
    : 'Scene context: none';

  const system =
    'You design teacher-reviewed MiroFish classroom activities. Return only valid JSON that matches the requested schema.';

  const user = `Create a structured MiroFish authoring spec for an existing classroom.

Teacher brief:
${input.goal}

Classroom context:
- Stage name: ${input.stageName}
- Activity type: ${input.activityType}
- Target audience: ${input.targetAudience}
- Include report: ${input.includeReport ? 'yes' : 'no'}
- Default surface after attach: ${input.defaultSurface}
- Collaboration mode after attach: ${input.collaborationMode}
${sceneContextBlock}

Instructions:
- Preserve the teacher's requested activity type, target audience, includeReport, defaultSurface, and collaborationMode exactly.
- Produce a concise but concrete title.
- Produce 3-6 teacherInstructions.
- Produce 3-6 studentTasks.
- Produce 2-6 successChecks.
- reportFocus may be empty when includeReport is false.
- authoringNotes should be optional and brief.
- Keep the output compatible with a classroom-side interactive activity, not a slide deck.

Return JSON in this exact shape:
{
  "title": "string",
  "brief": "string",
  "goal": "string",
  "activityType": "simulation | investigation | workspace | concept-map | data-story",
  "targetAudience": "string",
  "includeReport": true,
  "defaultSurface": "lesson | simulation",
  "collaborationMode": "single-controller | multi-user",
  "teacherInstructions": ["string", "string"],
  "studentTasks": ["string", "string"],
  "successChecks": ["string", "string"],
  "reportFocus": ["string"],
  "authoringNotes": "string",
  "sceneContext": {
    "sceneId": "string",
    "sceneTitle": "string",
    "sceneType": "slide | quiz | interactive | pbl",
    "teacherControls": ["string"],
    "misconceptionHooks": ["string"],
    "assessmentPolicy": "string"
  }
}`;

  return { system, user, promptPreview };
}

function parseMiroFishCreationSpecResponse(
  text: string,
  input: GenerateMiroFishCreationSpecInput,
): MiroFishCreationSpec {
  const repaired = jsonrepair(stripCodeFences(text));
  const parsed = miroFishCreationSpecSchema.parse(JSON.parse(repaired));

  return {
    ...parsed,
    brief: input.goal.trim(),
    goal: input.goal.trim(),
    activityType: input.activityType,
    targetAudience: input.targetAudience.trim(),
    includeReport: input.includeReport,
    defaultSurface: input.defaultSurface,
    collaborationMode: input.collaborationMode,
    reportFocus: input.includeReport ? parsed.reportFocus : [],
    sceneContext: normalizeSceneContext(input.sceneContext),
  };
}

export async function generateMiroFishCreationSpec(
  input: GenerateMiroFishCreationSpecInput,
): Promise<{ spec: MiroFishCreationSpec; promptPreview: string }> {
  const request = miroFishCreationPlanRequestSchema.parse(input);
  if (request.collaborationMode === 'multi-user' && !isMiroFishMultiUserEnabled()) {
    throw new Error('MiroFish multi-user mode is not enabled for this deployment');
  }

  const prompts = buildMiroFishCreationPrompt(input);
  const result = await input.aiCall(prompts.system, prompts.user);

  return {
    spec: parseMiroFishCreationSpecResponse(result, input),
    promptPreview: prompts.promptPreview,
  };
}

export async function publishMiroFishAuthoringJob(input: {
  spec: MiroFishCreationSpec;
  includeReport: boolean;
  source: 'raic-classroom';
}): Promise<{ jobId: string }> {
  assertMiroFishAuthoringAvailable();
  const { apiKey } = getMiroFishConfig();
  const response = await fetch(createAuthoringUrl('/api/authoring/publish'), {
    method: 'POST',
    headers: createAuthoringHeaders(apiKey!),
    cache: 'no-store',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(
      `MiroFish authoring publish failed (${response.status})${message ? `: ${message.slice(0, 200)}` : ''}`,
    );
  }

  const json = (await response.json()) as { jobId?: string };
  const jobId = json.jobId?.trim();
  if (!jobId) {
    throw new Error('MiroFish authoring publish returned no jobId');
  }

  return { jobId };
}

export async function readMiroFishAuthoringJobStatus(
  externalJobId: string,
): Promise<MiroFishAuthoringResult> {
  assertMiroFishAuthoringAvailable();
  const { apiKey } = getMiroFishConfig();
  const response = await fetch(
    createAuthoringUrl(`/api/authoring/jobs/${encodeURIComponent(externalJobId)}`),
    {
      method: 'GET',
      headers: createAuthoringHeaders(apiKey!),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(
      `MiroFish authoring status failed (${response.status})${message ? `: ${message.slice(0, 200)}` : ''}`,
    );
  }

  try {
    return miroFishAuthoringResultSchema.parse(await response.json());
  } catch (error) {
    log.warn('Invalid MiroFish authoring status payload:', error);
    throw new Error('MiroFish authoring status response was invalid');
  }
}

export function buildMiroFishCreationFailureMessage(input: {
  result: MiroFishAuthoringResult;
  fallbackMessage?: string;
}) {
  return input.result.error?.trim() || input.fallbackMessage || 'MiroFish authoring failed';
}

export function buildMiroFishCreationBriefPreview(goal: string) {
  return normalizePreview(goal);
}

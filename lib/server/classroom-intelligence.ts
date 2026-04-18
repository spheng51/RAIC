import 'server-only';

import { createHash, randomUUID } from 'crypto';
import path from 'path';
import perfBudgets from '@/ops/perf-budgets.json';
import {
  readPlatformStore,
  runPostgresQuery,
  runPostgresTransaction,
  updatePlatformStore,
} from '@/lib/db/client';
import type {
  BenchmarkArtifactRecord,
  ClassroomReflectionRecord,
  ClassroomSessionContextRecord,
} from '@/lib/db/schema';
import {
  type AdaptiveGenerationContext,
  type AdaptivePacingPreference,
  type BenchmarkArtifactStatus,
  type BenchmarkMetricResult,
  type ClassroomRevisitIntent,
  CLASSROOM_REVISIT_INTENTS,
} from '@/lib/types/classroom-intelligence';
import { writeJsonFileAtomic } from '@/lib/server/classroom-storage';

const PERF_RESULTS_PATH = path.join(process.cwd(), 'data', 'perf-results', 'latest.json');
const REQUIREMENT_PREVIEW_MAX_LENGTH = 180;
const MAX_INTELLIGENCE_TAGS = 8;
const MAX_REFLECTION_SUMMARY_LENGTH = 2000;

type ClassroomSessionContextRow = {
  id: string;
  classroom_id: string;
  organization_id: string | null;
  user_id: string | null;
  requirement_fingerprint: string;
  requirement_preview: string;
  language: string;
  stage_name: string;
  last_completed_scene_id: string | null;
  last_completed_scene_title: string | null;
  completed_scene_count: number;
  total_scene_count: number;
  mastery_hints: string[] | null;
  revisit_intent: ClassroomRevisitIntent;
  pacing_preference: AdaptivePacingPreference;
  reflection_summary: string | null;
  confidence_score: number | null;
  created_at: string;
  updated_at: string;
};

type ClassroomReflectionRow = {
  id: string;
  classroom_id: string;
  organization_id: string | null;
  user_id: string | null;
  summary: string;
  challenging_areas: string[] | null;
  confidence_score: number | null;
  revisit_intent: ClassroomRevisitIntent;
  created_at: string;
};

type BenchmarkArtifactRow = {
  id: string;
  scope: string;
  source: string;
  classroom_id: string | null;
  organization_id: string | null;
  user_id: string | null;
  status: BenchmarkArtifactStatus;
  metrics: Record<string, unknown> | null;
  notes: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

interface UpsertClassroomSessionContextInput {
  classroomId: string;
  organizationId?: string | null;
  userId?: string | null;
  requirement?: string | null;
  stageName: string;
  language: string;
  lastCompletedSceneId?: string | null;
  lastCompletedSceneTitle?: string | null;
  completedSceneCount: number;
  totalSceneCount: number;
  masteryHints?: string[];
  revisitIntent?: ClassroomRevisitIntent;
  pacingPreference?: AdaptivePacingPreference;
  reflectionSummary?: string | null;
  confidenceScore?: number | null;
}

interface CreateClassroomReflectionInput {
  classroomId: string;
  organizationId?: string | null;
  userId?: string | null;
  summary: string;
  challengingAreas?: string[];
  confidenceScore?: number | null;
  revisitIntent?: ClassroomRevisitIntent;
}

interface RecordBenchmarkArtifactInput {
  scope: string;
  source: string;
  classroomId?: string | null;
  organizationId?: string | null;
  userId?: string | null;
  metrics: Partial<Record<PerfBudgetMetricName, number>>;
  notes?: string[];
  metadata?: Record<string, unknown>;
}

type PerfBudgetMetricName = keyof typeof perfBudgets.metricTargets;

export interface BenchmarkArtifactSnapshot {
  latestArtifactId: string;
  createdAt: string;
  scope: string;
  source: string;
  status: BenchmarkArtifactStatus;
  metrics: Record<string, BenchmarkMetricResult>;
  notes: string[];
  metadata: Record<string, unknown>;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function dedupeStrings(values: string[] | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values ?? []) {
    const normalized = normalizeText(value);
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result.slice(0, MAX_INTELLIGENCE_TAGS);
}

function isClassroomRevisitIntent(value: unknown): value is ClassroomRevisitIntent {
  return (
    typeof value === 'string' && (CLASSROOM_REVISIT_INTENTS as readonly string[]).includes(value)
  );
}

function clampConfidenceScore(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  return Math.min(5, Math.max(1, Math.round(value)));
}

function normalizeSceneCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

export function normalizeRevisitIntent(
  value: unknown,
  fallback: ClassroomRevisitIntent = 'continue',
): ClassroomRevisitIntent {
  return isClassroomRevisitIntent(value) ? value : fallback;
}

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeStrings(value.filter((entry): entry is string => typeof entry === 'string'));
}

export function normalizeReflectionSummary(value: unknown): string {
  return truncateText(
    normalizeText(typeof value === 'string' ? value : ''),
    MAX_REFLECTION_SUMMARY_LENGTH,
  );
}

export function normalizeSceneProgress(input: {
  completedSceneCount: number | null | undefined;
  totalSceneCount: number | null | undefined;
}) {
  const totalSceneCount = normalizeSceneCount(input.totalSceneCount);
  const completedSceneCount = Math.min(
    totalSceneCount,
    normalizeSceneCount(input.completedSceneCount),
  );

  return {
    completedSceneCount,
    totalSceneCount,
  };
}

function mapClassroomSessionContextRow(
  row: ClassroomSessionContextRow,
): ClassroomSessionContextRecord {
  return {
    id: row.id,
    classroomId: row.classroom_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    requirementFingerprint: row.requirement_fingerprint,
    requirementPreview: row.requirement_preview,
    language: row.language,
    stageName: row.stage_name,
    lastCompletedSceneId: row.last_completed_scene_id,
    lastCompletedSceneTitle: row.last_completed_scene_title,
    completedSceneCount: Number(row.completed_scene_count ?? 0),
    totalSceneCount: Number(row.total_scene_count ?? 0),
    masteryHints: dedupeStrings(row.mastery_hints ?? []),
    revisitIntent: row.revisit_intent,
    pacingPreference: row.pacing_preference,
    reflectionSummary: row.reflection_summary,
    confidenceScore: clampConfidenceScore(row.confidence_score),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClassroomReflectionRow(row: ClassroomReflectionRow): ClassroomReflectionRecord {
  return {
    id: row.id,
    classroomId: row.classroom_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    summary: row.summary,
    challengingAreas: dedupeStrings(row.challenging_areas ?? []),
    confidenceScore: clampConfidenceScore(row.confidence_score),
    revisitIntent: row.revisit_intent,
    createdAt: row.created_at,
  };
}

function mapBenchmarkArtifactRow(row: BenchmarkArtifactRow): BenchmarkArtifactRecord {
  return {
    id: row.id,
    scope: row.scope,
    source: row.source,
    classroomId: row.classroom_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    status: row.status,
    metrics: row.metrics ?? {},
    notes: row.notes ?? [],
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

export function buildRequirementFingerprint(requirement: string): {
  fingerprint: string;
  preview: string;
} {
  const normalized = normalizeText(requirement);
  const preview = truncateText(normalized, REQUIREMENT_PREVIEW_MAX_LENGTH);
  const fingerprint = createHash('sha256')
    .update(normalized.toLowerCase())
    .digest('hex')
    .slice(0, 24);

  return {
    fingerprint,
    preview,
  };
}

function derivePacingPreference(input: {
  completedSceneCount: number;
  totalSceneCount: number;
  revisitIntent?: ClassroomRevisitIntent;
  confidenceScore?: number | null;
}): AdaptivePacingPreference {
  const normalizedConfidence = clampConfidenceScore(input.confidenceScore);
  const progressRatio =
    input.totalSceneCount > 0 ? input.completedSceneCount / input.totalSceneCount : 0;

  if (
    input.revisitIntent === 'remediate' ||
    (normalizedConfidence !== null && normalizedConfidence <= 2)
  ) {
    return 'remediate';
  }

  if (
    input.revisitIntent === 'deepen' ||
    (normalizedConfidence !== null && normalizedConfidence >= 4 && progressRatio >= 0.6)
  ) {
    return 'accelerate';
  }

  if (progressRatio > 0 || input.revisitIntent === 'revisit') {
    return 'balance';
  }

  return 'adaptive';
}

export async function getClassroomSessionContext(params: {
  classroomId: string;
  userId?: string | null;
}): Promise<ClassroomSessionContextRecord | null> {
  if (!params.userId) {
    return null;
  }

  const postgresResult = await runPostgresQuery<ClassroomSessionContextRow>(
    `SELECT
      id,
      classroom_id,
      organization_id,
      user_id,
      requirement_fingerprint,
      requirement_preview,
      language,
      stage_name,
      last_completed_scene_id,
      last_completed_scene_title,
      completed_scene_count,
      total_scene_count,
      mastery_hints,
      revisit_intent,
      pacing_preference,
      reflection_summary,
      confidence_score,
      created_at,
      updated_at
     FROM classroom_session_contexts
     WHERE classroom_id = $1 AND user_id = $2
     LIMIT 1`,
    [params.classroomId, params.userId],
  );

  if (postgresResult) {
    return postgresResult[0] ? mapClassroomSessionContextRow(postgresResult[0]) : null;
  }

  const store = await readPlatformStore();
  const contexts = store.classroomSessionContexts.filter(
    (record) => record.classroomId === params.classroomId && record.userId === params.userId,
  );

  return contexts[0] ?? null;
}

export async function upsertClassroomSessionContext(
  input: UpsertClassroomSessionContextInput,
): Promise<ClassroomSessionContextRecord> {
  const existing = await getClassroomSessionContext({
    classroomId: input.classroomId,
    userId: input.userId ?? null,
  });
  const { completedSceneCount, totalSceneCount } = normalizeSceneProgress({
    completedSceneCount: input.completedSceneCount,
    totalSceneCount: input.totalSceneCount,
  });
  const normalizedRequirement = normalizeText(input.requirement);
  const requirementData = normalizedRequirement
    ? buildRequirementFingerprint(normalizedRequirement)
    : existing
      ? {
          fingerprint: existing.requirementFingerprint,
          preview: existing.requirementPreview,
        }
      : buildRequirementFingerprint(normalizeText(input.stageName) || input.classroomId);
  const now = new Date().toISOString();
  const masteryHints = dedupeStrings([
    ...(existing?.masteryHints ?? []),
    ...(input.masteryHints ?? []),
  ]);
  const revisitIntent = normalizeRevisitIntent(
    input.revisitIntent,
    existing?.revisitIntent ?? 'continue',
  );
  const confidenceScore =
    clampConfidenceScore(input.confidenceScore) ?? existing?.confidenceScore ?? null;
  const pacingPreference =
    input.pacingPreference ??
    derivePacingPreference({
      completedSceneCount,
      totalSceneCount,
      revisitIntent,
      confidenceScore,
    });

  const record: ClassroomSessionContextRecord = {
    id: existing?.id ?? randomUUID(),
    classroomId: input.classroomId,
    organizationId: input.organizationId ?? existing?.organizationId ?? null,
    userId: input.userId ?? existing?.userId ?? null,
    requirementFingerprint: requirementData.fingerprint,
    requirementPreview: requirementData.preview,
    language: normalizeText(input.language) || existing?.language || 'en-US',
    stageName: normalizeText(input.stageName) || existing?.stageName || 'Classroom',
    lastCompletedSceneId: input.lastCompletedSceneId ?? existing?.lastCompletedSceneId ?? null,
    lastCompletedSceneTitle:
      normalizeText(input.lastCompletedSceneTitle) || existing?.lastCompletedSceneTitle || null,
    completedSceneCount,
    totalSceneCount,
    masteryHints,
    revisitIntent,
    pacingPreference,
    reflectionSummary:
      normalizeReflectionSummary(input.reflectionSummary) || existing?.reflectionSummary || null,
    confidenceScore,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const postgresResult = await runPostgresTransaction<ClassroomSessionContextRow[] | null>(
    async (executor) =>
      executor.unsafe<ClassroomSessionContextRow>(
        `INSERT INTO classroom_session_contexts (
          id,
          classroom_id,
          organization_id,
          user_id,
          requirement_fingerprint,
          requirement_preview,
          language,
          stage_name,
          last_completed_scene_id,
          last_completed_scene_title,
          completed_scene_count,
          total_scene_count,
          mastery_hints,
          revisit_intent,
          pacing_preference,
          reflection_summary,
          confidence_score,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
        ON CONFLICT (classroom_id, user_id)
        DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          requirement_fingerprint = EXCLUDED.requirement_fingerprint,
          requirement_preview = EXCLUDED.requirement_preview,
          language = EXCLUDED.language,
          stage_name = EXCLUDED.stage_name,
          last_completed_scene_id = EXCLUDED.last_completed_scene_id,
          last_completed_scene_title = EXCLUDED.last_completed_scene_title,
          completed_scene_count = EXCLUDED.completed_scene_count,
          total_scene_count = EXCLUDED.total_scene_count,
          mastery_hints = EXCLUDED.mastery_hints,
          revisit_intent = EXCLUDED.revisit_intent,
          pacing_preference = EXCLUDED.pacing_preference,
          reflection_summary = EXCLUDED.reflection_summary,
          confidence_score = EXCLUDED.confidence_score,
          updated_at = EXCLUDED.updated_at
        RETURNING
          id,
          classroom_id,
          organization_id,
          user_id,
          requirement_fingerprint,
          requirement_preview,
          language,
          stage_name,
          last_completed_scene_id,
          last_completed_scene_title,
          completed_scene_count,
          total_scene_count,
          mastery_hints,
          revisit_intent,
          pacing_preference,
          reflection_summary,
          confidence_score,
          created_at,
          updated_at`,
        [
          record.id,
          record.classroomId,
          record.organizationId,
          record.userId,
          record.requirementFingerprint,
          record.requirementPreview,
          record.language,
          record.stageName,
          record.lastCompletedSceneId,
          record.lastCompletedSceneTitle,
          record.completedSceneCount,
          record.totalSceneCount,
          record.masteryHints,
          record.revisitIntent,
          record.pacingPreference,
          record.reflectionSummary,
          record.confidenceScore,
          record.createdAt,
          record.updatedAt,
        ],
      ),
  );

  if (postgresResult) {
    return mapClassroomSessionContextRow(postgresResult[0]);
  }

  return updatePlatformStore((store) => {
    const index = store.classroomSessionContexts.findIndex(
      (entry) => entry.classroomId === record.classroomId && entry.userId === record.userId,
    );

    if (index >= 0) {
      store.classroomSessionContexts[index] = record;
    } else {
      store.classroomSessionContexts.push(record);
    }

    return record;
  });
}

export async function listRecentSessionContextsByRequirement(input: {
  organizationId?: string | null;
  userId?: string | null;
  requirement: string;
  limit?: number;
}): Promise<ClassroomSessionContextRecord[]> {
  if (!input.userId) {
    return [];
  }

  const { fingerprint } = buildRequirementFingerprint(input.requirement);
  const limit = Math.max(1, Math.min(input.limit ?? 5, 10));

  const postgresResult = await runPostgresQuery<ClassroomSessionContextRow>(
    `SELECT
      id,
      classroom_id,
      organization_id,
      user_id,
      requirement_fingerprint,
      requirement_preview,
      language,
      stage_name,
      last_completed_scene_id,
      last_completed_scene_title,
      completed_scene_count,
      total_scene_count,
      mastery_hints,
      revisit_intent,
      pacing_preference,
      reflection_summary,
      confidence_score,
      created_at,
      updated_at
     FROM classroom_session_contexts
     WHERE user_id = $1
       AND requirement_fingerprint = $2
       AND ($3::text IS NULL OR organization_id = $3)
     ORDER BY updated_at DESC
     LIMIT $4`,
    [input.userId, fingerprint, input.organizationId ?? null, limit],
  );

  if (postgresResult) {
    return postgresResult.map(mapClassroomSessionContextRow);
  }

  const store = await readPlatformStore();
  const records = store.classroomSessionContexts
    .filter(
      (entry) =>
        entry.userId === input.userId &&
        entry.requirementFingerprint === fingerprint &&
        (input.organizationId == null || entry.organizationId === input.organizationId),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);

  return records;
}

export async function buildAdaptiveGenerationContext(input: {
  organizationId?: string | null;
  userId?: string | null;
  requirement: string;
}): Promise<AdaptiveGenerationContext | null> {
  const contexts = await listRecentSessionContextsByRequirement({
    organizationId: input.organizationId ?? null,
    userId: input.userId ?? null,
    requirement: input.requirement,
    limit: 3,
  });

  if (contexts.length === 0) {
    return null;
  }

  const masteryHints = dedupeStrings(contexts.flatMap((context) => context.masteryHints)).slice(
    0,
    6,
  );
  const latest = contexts[0];

  return {
    requirementFingerprint: latest.requirementFingerprint,
    priorSessions: contexts.length,
    lastCompletedSceneTitle: latest.lastCompletedSceneTitle,
    masteryHints,
    revisitIntent: latest.revisitIntent,
    pacingPreference: latest.pacingPreference,
    reflectionSummary: latest.reflectionSummary,
    confidenceScore: latest.confidenceScore,
  };
}

export function formatAdaptiveContextForPrompt(context: AdaptiveGenerationContext | null): string {
  if (!context) {
    return '';
  }

  const promptLines = [
    '## Adaptive Session Context',
    `This requirement matches ${context.priorSessions} prior session(s). Treat this as a repeated-session classroom, not a first-time lesson.`,
  ];

  if (context.lastCompletedSceneTitle) {
    promptLines.push(`- Last completed segment: ${context.lastCompletedSceneTitle}`);
  }

  promptLines.push(`- Revisit intent: ${context.revisitIntent}`);
  promptLines.push(`- Pacing policy: ${context.pacingPreference}`);

  if (context.confidenceScore !== null) {
    promptLines.push(`- Latest self-reported confidence: ${context.confidenceScore}/5`);
  }

  if (context.masteryHints.length > 0) {
    promptLines.push(`- Mastery hints: ${context.masteryHints.join('; ')}`);
  }

  if (context.reflectionSummary) {
    promptLines.push(`- Reflection summary: ${context.reflectionSummary}`);
  }

  promptLines.push(
    'Requirements:',
    '- Reuse the prior context to avoid repeating introductory material verbatim.',
    '- If pacing policy is remediate, start with a concise recap and explicitly strengthen weak areas before advancing.',
    '- If pacing policy is accelerate, compress foundational review and spend more time on transfer, synthesis, or application.',
    '- Keep the final classroom coherent for a returning learner.',
  );

  return promptLines.join('\n');
}

export async function createClassroomReflection(
  input: CreateClassroomReflectionInput,
): Promise<ClassroomReflectionRecord> {
  const record: ClassroomReflectionRecord = {
    id: randomUUID(),
    classroomId: input.classroomId,
    organizationId: input.organizationId ?? null,
    userId: input.userId ?? null,
    summary: normalizeReflectionSummary(input.summary),
    challengingAreas: dedupeStrings(input.challengingAreas),
    confidenceScore: clampConfidenceScore(input.confidenceScore),
    revisitIntent: normalizeRevisitIntent(input.revisitIntent),
    createdAt: new Date().toISOString(),
  };

  const postgresResult = await runPostgresTransaction<ClassroomReflectionRow[] | null>(
    async (executor) =>
      executor.unsafe<ClassroomReflectionRow>(
        `INSERT INTO classroom_reflections (
          id,
          classroom_id,
          organization_id,
          user_id,
          summary,
          challenging_areas,
          confidence_score,
          revisit_intent,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING
          id,
          classroom_id,
          organization_id,
          user_id,
          summary,
          challenging_areas,
          confidence_score,
          revisit_intent,
          created_at`,
        [
          record.id,
          record.classroomId,
          record.organizationId,
          record.userId,
          record.summary,
          record.challengingAreas,
          record.confidenceScore,
          record.revisitIntent,
          record.createdAt,
        ],
      ),
  );

  const persisted =
    postgresResult?.[0] != null
      ? mapClassroomReflectionRow(postgresResult[0])
      : await updatePlatformStore((store) => {
          store.classroomReflections.push(record);
          return record;
        });

  const existingContext = await getClassroomSessionContext({
    classroomId: input.classroomId,
    userId: input.userId ?? null,
  });

  if (existingContext) {
    await upsertClassroomSessionContext({
      classroomId: existingContext.classroomId,
      organizationId: existingContext.organizationId,
      userId: existingContext.userId,
      stageName: existingContext.stageName,
      language: existingContext.language,
      lastCompletedSceneId: existingContext.lastCompletedSceneId,
      lastCompletedSceneTitle: existingContext.lastCompletedSceneTitle,
      completedSceneCount: existingContext.completedSceneCount,
      totalSceneCount: existingContext.totalSceneCount,
      masteryHints: persisted.challengingAreas,
      revisitIntent: persisted.revisitIntent,
      reflectionSummary: persisted.summary,
      confidenceScore: persisted.confidenceScore,
    });
  }

  return persisted;
}

export async function listClassroomReflections(input: {
  classroomId: string;
  userId?: string | null;
  limit?: number;
}): Promise<ClassroomReflectionRecord[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 10, 20));
  const postgresResult = await runPostgresQuery<ClassroomReflectionRow>(
    `SELECT
      id,
      classroom_id,
      organization_id,
      user_id,
      summary,
      challenging_areas,
      confidence_score,
      revisit_intent,
      created_at
     FROM classroom_reflections
     WHERE classroom_id = $1
       AND ($2::text IS NULL OR user_id = $2)
     ORDER BY created_at DESC
     LIMIT $3`,
    [input.classroomId, input.userId ?? null, limit],
  );

  if (postgresResult) {
    return postgresResult.map(mapClassroomReflectionRow);
  }

  const store = await readPlatformStore();
  return store.classroomReflections
    .filter(
      (entry) =>
        entry.classroomId === input.classroomId &&
        (input.userId == null || entry.userId === input.userId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function buildAdaptiveRuntimeContext(input: {
  classroomId: string;
  userId?: string | null;
}): Promise<AdaptiveGenerationContext | null> {
  if (!input.userId) {
    return null;
  }

  const [context, latestReflection] = await Promise.all([
    getClassroomSessionContext({
      classroomId: input.classroomId,
      userId: input.userId,
    }),
    listClassroomReflections({
      classroomId: input.classroomId,
      userId: input.userId,
      limit: 1,
    }).then((reflections) => reflections[0] ?? null),
  ]);

  if (!context && !latestReflection) {
    return null;
  }

  const masteryHints = dedupeStrings([
    ...(context?.masteryHints ?? []),
    ...(latestReflection?.challengingAreas ?? []),
  ]);
  const revisitIntent = latestReflection?.revisitIntent ?? context?.revisitIntent ?? 'continue';
  const confidenceScore = latestReflection?.confidenceScore ?? context?.confidenceScore ?? null;
  const reflectionSummary = latestReflection?.summary ?? context?.reflectionSummary ?? null;
  const hasReturningSignals =
    (context?.completedSceneCount ?? 0) > 0 ||
    masteryHints.length > 0 ||
    reflectionSummary !== null ||
    confidenceScore !== null;

  if (!hasReturningSignals) {
    return null;
  }

  return {
    requirementFingerprint: context?.requirementFingerprint ?? input.classroomId,
    priorSessions: 1,
    lastCompletedSceneTitle: context?.lastCompletedSceneTitle ?? null,
    masteryHints,
    revisitIntent,
    pacingPreference:
      context?.pacingPreference ??
      derivePacingPreference({
        completedSceneCount: context?.completedSceneCount ?? 0,
        totalSceneCount: context?.totalSceneCount ?? 0,
        revisitIntent,
        confidenceScore,
      }),
    reflectionSummary,
    confidenceScore,
  };
}

function buildMetricResults(
  metrics: Partial<Record<PerfBudgetMetricName, number>>,
): Record<string, BenchmarkMetricResult> {
  return Object.fromEntries(
    Object.entries(perfBudgets.metricTargets).map(([name, threshold]) => {
      const rawValue = metrics[name as PerfBudgetMetricName];
      const value = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null;

      return [
        name,
        {
          value,
          threshold,
          status: value === null ? 'missing' : value <= threshold ? 'pass' : 'warn',
        } satisfies BenchmarkMetricResult,
      ];
    }),
  );
}

function deriveBenchmarkStatus(
  metricResults: Record<string, BenchmarkMetricResult>,
): BenchmarkArtifactStatus {
  const statuses = Object.values(metricResults).map((metric) => metric.status);
  if (statuses.includes('warn')) {
    return 'warn';
  }
  if (statuses.includes('pass')) {
    return 'pass';
  }
  return 'missing';
}

export async function recordBenchmarkArtifact(
  input: RecordBenchmarkArtifactInput,
): Promise<BenchmarkArtifactRecord> {
  const metricResults = buildMetricResults(input.metrics);
  const record: BenchmarkArtifactRecord = {
    id: randomUUID(),
    scope: input.scope,
    source: input.source,
    classroomId: input.classroomId ?? null,
    organizationId: input.organizationId ?? null,
    userId: input.userId ?? null,
    status: deriveBenchmarkStatus(metricResults),
    metrics: metricResults,
    notes: input.notes ?? [],
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  };

  const postgresResult = await runPostgresTransaction<BenchmarkArtifactRow[] | null>(
    async (executor) =>
      executor.unsafe<BenchmarkArtifactRow>(
        `INSERT INTO benchmark_artifacts (
          id,
          scope,
          source,
          classroom_id,
          organization_id,
          user_id,
          status,
          metrics,
          notes,
          metadata,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING
          id,
          scope,
          source,
          classroom_id,
          organization_id,
          user_id,
          status,
          metrics,
          notes,
          metadata,
          created_at`,
        [
          record.id,
          record.scope,
          record.source,
          record.classroomId,
          record.organizationId,
          record.userId,
          record.status,
          record.metrics,
          record.notes,
          record.metadata,
          record.createdAt,
        ],
      ),
  );

  const persisted =
    postgresResult?.[0] != null
      ? mapBenchmarkArtifactRow(postgresResult[0])
      : await updatePlatformStore((store) => {
          store.benchmarkArtifacts.push(record);
          return record;
        });

  await writeJsonFileAtomic(PERF_RESULTS_PATH, {
    latestArtifactId: persisted.id,
    createdAt: persisted.createdAt,
    scope: persisted.scope,
    source: persisted.source,
    status: persisted.status,
    metrics: persisted.metrics,
    notes: persisted.notes,
    metadata: persisted.metadata,
  });

  return persisted;
}

export async function listBenchmarkArtifacts(
  input: {
    scope?: string | null;
    limit?: number;
  } = {},
): Promise<BenchmarkArtifactRecord[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const postgresResult = await runPostgresQuery<BenchmarkArtifactRow>(
    `SELECT
      id,
      scope,
      source,
      classroom_id,
      organization_id,
      user_id,
      status,
      metrics,
      notes,
      metadata,
      created_at
     FROM benchmark_artifacts
     WHERE ($1::text IS NULL OR scope = $1)
     ORDER BY created_at DESC
     LIMIT $2`,
    [input.scope ?? null, limit],
  );

  if (postgresResult) {
    return postgresResult.map(mapBenchmarkArtifactRow);
  }

  const store = await readPlatformStore();
  return store.benchmarkArtifacts
    .filter((entry) => input.scope == null || entry.scope === input.scope)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function syncLatestBenchmarkArtifactSnapshot(): Promise<void> {
  const latestArtifact = (await listBenchmarkArtifacts({ limit: 1 }))[0] ?? null;
  if (!latestArtifact) {
    try {
      const fs = await import('fs/promises');
      await fs.rm(PERF_RESULTS_PATH, { force: true });
    } catch {
      // Best effort cleanup; the snapshot is advisory state derived from stored artifacts.
    }
    return;
  }

  await writeJsonFileAtomic(PERF_RESULTS_PATH, {
    latestArtifactId: latestArtifact.id,
    createdAt: latestArtifact.createdAt,
    scope: latestArtifact.scope,
    source: latestArtifact.source,
    status: latestArtifact.status,
    metrics: latestArtifact.metrics,
    notes: latestArtifact.notes,
    metadata: latestArtifact.metadata,
  });
}

export async function getLatestBenchmarkArtifactSnapshot(): Promise<BenchmarkArtifactSnapshot | null> {
  try {
    const fs = await import('fs/promises');
    const raw = await fs.readFile(PERF_RESULTS_PATH, 'utf8');
    return JSON.parse(raw) as BenchmarkArtifactSnapshot;
  } catch {
    return null;
  }
}

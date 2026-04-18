export const CLASSROOM_REVISIT_INTENTS = [
  'continue',
  'revisit',
  'remediate',
  'deepen',
] as const;

export type ClassroomRevisitIntent = (typeof CLASSROOM_REVISIT_INTENTS)[number];

export const ADAPTIVE_PACING_PREFERENCES = [
  'adaptive',
  'accelerate',
  'balance',
  'remediate',
] as const;

export type AdaptivePacingPreference = (typeof ADAPTIVE_PACING_PREFERENCES)[number];

export const PROVIDER_SCENARIO_TASK_BUCKETS = [
  'scene',
  'image',
  'video',
  'tts',
  'transcript',
  'webSearch',
] as const;

export type ProviderScenarioTaskBucket = (typeof PROVIDER_SCENARIO_TASK_BUCKETS)[number];

export interface ProviderScenarioCandidate {
  providerId: string;
  modelId?: string;
  note?: string;
}

export interface ProviderScenarioProfile {
  id: string;
  description: string;
  buckets: Partial<Record<ProviderScenarioTaskBucket, ProviderScenarioCandidate[]>>;
}

export interface AdaptiveGenerationContext {
  requirementFingerprint: string;
  priorSessions: number;
  lastCompletedSceneTitle: string | null;
  masteryHints: string[];
  revisitIntent: ClassroomRevisitIntent;
  pacingPreference: AdaptivePacingPreference;
  reflectionSummary: string | null;
  confidenceScore: number | null;
}

export const BENCHMARK_ARTIFACT_STATUSES = ['pass', 'warn', 'missing'] as const;

export type BenchmarkArtifactStatus = (typeof BENCHMARK_ARTIFACT_STATUSES)[number];

export interface BenchmarkMetricResult {
  value: number | null;
  threshold: number;
  status: BenchmarkArtifactStatus;
  description?: string;
}

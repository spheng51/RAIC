import type {
  GenerationWarning,
  SceneExecutionPolicy,
  SceneGenerationSummary,
  SceneOutcome,
  SceneOutline,
} from '@/lib/types/generation';
import { createLogger } from '@/lib/logger';

const log = createLogger('SceneExecutor');

export const DEFAULT_SCENE_EXECUTION_POLICY: SceneExecutionPolicy = {
  concurrency: 2,
  maxAttempts: 3,
  retryDelaysMs: [500, 1500, 4000],
  retryableErrorCodes: [
    'network_error',
    'provider_unavailable',
    'rate_limit',
    'timeout',
    'transient_provider_error',
  ],
};

export interface SceneExecutionItem<TContext = undefined> {
  outline: SceneOutline;
  index: number;
  context?: TContext;
}

export interface SceneExecutionProgress {
  totalScenes: number;
  completedScenes: number;
  generatedScenes: number;
  failedScenes: number;
  latestOutcome: SceneOutcome;
  warnings: GenerationWarning[];
  sceneOutcomes: SceneOutcome[];
}

export type SceneExecutionFn<TContext = undefined> = (
  item: SceneExecutionItem<TContext>,
  attempt: number,
) => Promise<SceneOutcome>;

function sanitizeSceneErrorMessage(message: string): string {
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bsk-ant-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z\-_]{20,}\b/g, '[REDACTED]')
    .trim()
    .slice(0, 300);
}

function classifyUnexpectedSceneError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  const errorWithMeta = error as Error & {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    cause?: unknown;
  };
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unexpected scene generation failure';
  const message = sanitizeSceneErrorMessage(rawMessage);
  const codeCandidates = [
    errorWithMeta?.code,
    errorWithMeta?.statusCode,
    errorWithMeta?.status,
    error instanceof Error ? error.name : undefined,
  ]
    .map((value) => (value == null ? '' : String(value).toLowerCase()))
    .filter(Boolean);
  const haystack = `${codeCandidates.join(' ')} ${message.toLowerCase()}`;

  if (/\b429\b|rate limit|too many requests/.test(haystack)) {
    return { code: 'rate_limit', message, retryable: true };
  }
  if (
    /\b408\b|\b502\b|\b503\b|\b504\b|timeout|timed out|overloaded|temporarily unavailable/.test(
      haystack,
    )
  ) {
    return { code: 'timeout', message, retryable: true };
  }
  if (
    /econnreset|etimedout|econnrefused|enotfound|eai_again|network|socket|fetch failed|connect timeout/.test(
      haystack,
    )
  ) {
    return { code: 'network_error', message, retryable: true };
  }
  if (/service unavailable|internal server error|bad gateway|gateway timeout/.test(haystack)) {
    return { code: 'provider_unavailable', message, retryable: true };
  }

  return {
    code: 'scene_generation_failed',
    message: message || 'Unexpected scene generation failure',
    retryable: false,
  };
}

function normalizeSceneExecutionPolicy(
  policy?: Partial<SceneExecutionPolicy>,
): SceneExecutionPolicy {
  return {
    concurrency: Math.max(1, policy?.concurrency ?? DEFAULT_SCENE_EXECUTION_POLICY.concurrency),
    maxAttempts: Math.max(1, policy?.maxAttempts ?? DEFAULT_SCENE_EXECUTION_POLICY.maxAttempts),
    retryDelaysMs:
      policy?.retryDelaysMs?.length && policy.retryDelaysMs.length > 0
        ? [...policy.retryDelaysMs]
        : [...DEFAULT_SCENE_EXECUTION_POLICY.retryDelaysMs],
    retryableErrorCodes:
      policy?.retryableErrorCodes?.length && policy.retryableErrorCodes.length > 0
        ? [...policy.retryableErrorCodes]
        : [...DEFAULT_SCENE_EXECUTION_POLICY.retryableErrorCodes],
  };
}

function shouldRetrySceneOutcome(outcome: SceneOutcome, policy: SceneExecutionPolicy): boolean {
  return outcome.retryable && policy.retryableErrorCodes.includes(outcome.code);
}

function getRetryDelayMs(policy: SceneExecutionPolicy, attempt: number): number {
  const fallbackDelay =
    policy.retryDelaysMs[policy.retryDelaysMs.length - 1] ??
    DEFAULT_SCENE_EXECUTION_POLICY.retryDelaysMs[
      DEFAULT_SCENE_EXECUTION_POLICY.retryDelaysMs.length - 1
    ];
  return policy.retryDelaysMs[attempt - 1] ?? fallbackDelay;
}

function toSceneWarning(outcome: SceneOutcome): GenerationWarning | null {
  if (outcome.status !== 'failed') {
    return null;
  }

  return {
    stage: 'scene',
    code: outcome.code,
    message: outcome.message,
    sceneIndex: outcome.index,
    sceneTitle: outcome.title,
    retryable: outcome.retryable,
    attempts: outcome.attempts,
  };
}

async function waitForRetry(delayMs: number) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function buildSummary(sceneOutcomes: SceneOutcome[]): SceneGenerationSummary {
  const sceneIds = sceneOutcomes
    .filter((outcome): outcome is SceneOutcome & { status: 'generated'; sceneId: string } => {
      return outcome.status === 'generated' && typeof outcome.sceneId === 'string';
    })
    .sort((left, right) => left.index - right.index)
    .map((outcome) => outcome.sceneId);
  const generatedScenes = sceneIds.length;
  const failedScenes = sceneOutcomes.length - generatedScenes;
  const completionStatus =
    generatedScenes === 0 ? 'failed' : failedScenes > 0 ? 'partial' : 'complete';
  const warnings = sceneOutcomes
    .map((outcome) => toSceneWarning(outcome))
    .filter((warning): warning is GenerationWarning => warning !== null);

  return {
    sceneIds,
    totalScenes: sceneOutcomes.length,
    generatedScenes,
    failedScenes,
    completionStatus,
    warnings,
    sceneOutcomes,
  };
}

export async function executeScenesWithPolicy<TContext = undefined>(input: {
  items: Array<SceneExecutionItem<TContext>>;
  executeScene: SceneExecutionFn<TContext>;
  policy?: Partial<SceneExecutionPolicy>;
  onProgress?: (progress: SceneExecutionProgress) => Promise<void> | void;
}): Promise<SceneGenerationSummary> {
  const policy = normalizeSceneExecutionPolicy(input.policy);
  const outcomes = new Array<SceneOutcome>(input.items.length);
  let cursor = 0;
  let completedScenes = 0;
  let generatedScenes = 0;
  let failedScenes = 0;
  const warnings: GenerationWarning[] = [];

  const executeItemWithRetry = async (
    item: SceneExecutionItem<TContext>,
  ): Promise<SceneOutcome> => {
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      try {
        const rawOutcome = await input.executeScene(item, attempt);
        const outcome: SceneOutcome = {
          ...rawOutcome,
          index: item.index,
          title: item.outline.title,
          attempts: rawOutcome.attempts || attempt,
        };

        if (outcome.status === 'generated') {
          return outcome;
        }

        if (attempt < policy.maxAttempts && shouldRetrySceneOutcome(outcome, policy)) {
          const delayMs = getRetryDelayMs(policy, attempt);
          log.warn(
            `Retrying scene "${item.outline.title}" after ${delayMs}ms [attempt ${attempt}/${policy.maxAttempts}]`,
          );
          await waitForRetry(delayMs);
          continue;
        }

        return outcome;
      } catch (error) {
        const classified = classifyUnexpectedSceneError(error);
        const outcome: SceneOutcome = {
          index: item.index,
          title: item.outline.title,
          status: 'failed',
          stage: 'content',
          attempts: attempt,
          retryable: classified.retryable,
          code: classified.code,
          message: classified.message,
        };

        if (attempt < policy.maxAttempts && shouldRetrySceneOutcome(outcome, policy)) {
          const delayMs = getRetryDelayMs(policy, attempt);
          log.warn(
            `Retrying scene "${item.outline.title}" after unexpected error [attempt ${attempt}/${policy.maxAttempts}]`,
            error,
          );
          await waitForRetry(delayMs);
          continue;
        }

        return outcome;
      }
    }

    return {
      index: item.index,
      title: item.outline.title,
      status: 'failed',
      stage: 'content',
      attempts: policy.maxAttempts,
      retryable: false,
      code: 'scene_generation_failed',
      message: 'Scene generation failed after all retry attempts',
    };
  };

  const workerCount = Math.min(policy.concurrency, input.items.length || 1);

  const worker = async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;

      if (currentIndex >= input.items.length) {
        return;
      }

      const item = input.items[currentIndex];
      const outcome = await executeItemWithRetry(item);
      outcomes[currentIndex] = outcome;
      completedScenes += 1;

      if (outcome.status === 'generated') {
        generatedScenes += 1;
      } else {
        failedScenes += 1;
        const warning = toSceneWarning(outcome);
        if (warning) {
          warnings.push(warning);
        }
      }

      await input.onProgress?.({
        totalScenes: input.items.length,
        completedScenes,
        generatedScenes,
        failedScenes,
        latestOutcome: outcome,
        warnings: [...warnings],
        sceneOutcomes: outcomes.filter((value): value is SceneOutcome => Boolean(value)),
      });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return buildSummary(outcomes);
}

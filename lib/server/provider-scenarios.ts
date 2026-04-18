import 'server-only';

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { createLogger } from '@/lib/logger';
import type {
  ProviderScenarioCandidate,
  ProviderScenarioProfile,
  ProviderScenarioTaskBucket,
} from '@/lib/types/classroom-intelligence';

const log = createLogger('ProviderScenarios');
const DEFAULT_PROVIDER_SCENARIO_ID = 'teacher-differentiation-v1';

type ScenarioYamlShape = Partial<{
  profiles: Record<
    string,
    Partial<{
      description: string;
      buckets: Partial<Record<ProviderScenarioTaskBucket, Array<string | ProviderScenarioCandidate>>>;
    }>
  >;
}>;

const TASK_BUCKET_ENV_MAP: Record<ProviderScenarioTaskBucket, string> = {
  scene: 'RAIC_PROVIDER_SCENARIO_SCENE',
  image: 'RAIC_PROVIDER_SCENARIO_IMAGE',
  video: 'RAIC_PROVIDER_SCENARIO_VIDEO',
  tts: 'RAIC_PROVIDER_SCENARIO_TTS',
  transcript: 'RAIC_PROVIDER_SCENARIO_TRANSCRIPT',
  webSearch: 'RAIC_PROVIDER_SCENARIO_WEB_SEARCH',
};

function parseCandidateToken(token: string): ProviderScenarioCandidate | null {
  const normalized = token.trim();
  if (!normalized) {
    return null;
  }

  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex < 0) {
    return { providerId: normalized };
  }

  return {
    providerId: normalized.slice(0, separatorIndex).trim(),
    modelId: normalized.slice(separatorIndex + 1).trim() || undefined,
  };
}

function normalizeCandidate(
  candidate: string | ProviderScenarioCandidate,
): ProviderScenarioCandidate | null {
  if (typeof candidate === 'string') {
    return parseCandidateToken(candidate);
  }

  const providerId = candidate.providerId?.trim();
  if (!providerId) {
    return null;
  }

  return {
    providerId,
    modelId: candidate.modelId?.trim() || undefined,
    note: candidate.note?.trim() || undefined,
  };
}

function parseCandidateList(rawValue: string | undefined): ProviderScenarioCandidate[] {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(',')
    .map((token) => parseCandidateToken(token))
    .filter((candidate): candidate is ProviderScenarioCandidate => candidate !== null);
}

function loadYamlProfiles(): Record<string, ProviderScenarioProfile> {
  try {
    const filePath = path.join(process.cwd(), 'server-provider-scenarios.yml');
    if (!fs.existsSync(filePath)) {
      return {};
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = yaml.load(raw) as ScenarioYamlShape | null;
    if (!parsed?.profiles || typeof parsed.profiles !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed.profiles).map(([profileId, profile]) => [
        profileId,
        {
          id: profileId,
          description:
            profile?.description?.trim() || 'Scenario profile loaded from server-provider-scenarios.yml.',
          buckets: Object.fromEntries(
            Object.entries(profile?.buckets ?? {}).map(([bucket, candidates]) => [
              bucket,
              (candidates ?? [])
                .map((candidate) => normalizeCandidate(candidate))
                .filter((candidate): candidate is ProviderScenarioCandidate => candidate !== null),
            ]),
          ) as ProviderScenarioProfile['buckets'],
        },
      ]),
    );
  } catch (error) {
    log.warn('Failed to load server-provider-scenarios.yml:', error);
    return {};
  }
}

function buildEnvProfile(): ProviderScenarioProfile | null {
  const buckets = Object.entries(TASK_BUCKET_ENV_MAP).reduce<ProviderScenarioProfile['buckets']>(
    (accumulator, [bucket, envName]) => {
      const candidates = parseCandidateList(process.env[envName]);
      if (candidates.length > 0) {
        accumulator[bucket as ProviderScenarioTaskBucket] = candidates;
      }
      return accumulator;
    },
    {},
  );

  if (Object.keys(buckets).length === 0) {
    return null;
  }

  return {
    id: process.env.RAIC_DEFAULT_PROVIDER_SCENARIO?.trim() || DEFAULT_PROVIDER_SCENARIO_ID,
    description: 'Scenario profile loaded from environment variables.',
    buckets,
  };
}

function mergeScenarioProfiles(
  baseProfile: ProviderScenarioProfile | null,
  overrideProfile: ProviderScenarioProfile,
): ProviderScenarioProfile {
  if (!baseProfile || baseProfile.id !== overrideProfile.id) {
    return overrideProfile;
  }

  return {
    ...baseProfile,
    buckets: {
      ...baseProfile.buckets,
      ...overrideProfile.buckets,
    },
  };
}

export function getProviderScenarioProfile(profileId?: string): ProviderScenarioProfile | null {
  const selectedId =
    profileId?.trim() ||
    process.env.RAIC_DEFAULT_PROVIDER_SCENARIO?.trim() ||
    DEFAULT_PROVIDER_SCENARIO_ID;
  const yamlProfiles = loadYamlProfiles();
  const envProfile = buildEnvProfile();

  if (envProfile && envProfile.id === selectedId) {
    return mergeScenarioProfiles(yamlProfiles[selectedId] ?? null, envProfile);
  }

  if (yamlProfiles[selectedId]) {
    return yamlProfiles[selectedId];
  }

  return envProfile ?? null;
}

export function hasProviderScenarioCandidates(
  taskBucket: ProviderScenarioTaskBucket,
  profileId?: string,
): boolean {
  const profile = getProviderScenarioProfile(profileId);
  return !!profile?.buckets[taskBucket]?.length;
}

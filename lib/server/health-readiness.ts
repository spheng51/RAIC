import 'server-only';

import type { PersistenceMode } from '@/lib/db/client';
import { getPersistenceMode, runPostgresQuery } from '@/lib/db/client';
import { isHostedEphemeralDataRoot } from '@/lib/server/data-root';
import { hasEncryptionKeyConfigured } from '@/lib/server/encrypted-secrets';
import { getMiroFishConfig, isMiroFishMultiUserEnabled } from '@/lib/server/mirofish';

interface ReadinessCheck {
  ready: boolean;
  reason: string | null;
}

interface HealthStorageReadiness extends ReadinessCheck {
  mode: PersistenceMode;
}

interface HealthAuthReadiness extends ReadinessCheck {
  browserClientIdConfigured: boolean;
  serverAudienceConfigured: boolean;
}

interface HealthEncryptionReadiness extends ReadinessCheck {
  configured: boolean;
}

interface HealthMiroFishReadiness extends ReadinessCheck {
  baseUrlConfigured: boolean;
  apiBaseUrlConfigured: boolean;
  apiAccessConfigured: boolean;
  embedSigningConfigured: boolean;
  multiUserEnabled: boolean;
}

export interface HealthReadinessReport {
  auth: HealthAuthReadiness;
  encryption: HealthEncryptionReadiness;
  storage: HealthStorageReadiness;
  mirofish: HealthMiroFishReadiness;
}

function hasConfiguredEnv(name: string) {
  return Boolean(process.env[name]?.trim());
}

function createReadyCheck(ready: boolean, reason: string | null = null): ReadinessCheck {
  return {
    ready,
    reason: ready ? null : reason,
  };
}

async function getStorageReadiness(): Promise<HealthStorageReadiness> {
  try {
    const mode = await getPersistenceMode();
    if (mode === 'postgres') {
      await runPostgresQuery('SELECT 1');
    }

    if (mode === 'json' && isHostedEphemeralDataRoot()) {
      return {
        mode,
        ...createReadyCheck(
          false,
          'DATABASE_URL is required for durable hosted storage; JSON fallback uses temporary runtime storage only',
        ),
      };
    }

    return {
      mode,
      ...createReadyCheck(true),
    };
  } catch (error) {
    return {
      mode: hasConfiguredEnv('DATABASE_URL') ? 'postgres' : 'json',
      ...createReadyCheck(
        false,
        error instanceof Error ? error.message : 'Platform storage readiness check failed',
      ),
    };
  }
}

function getAuthReadiness(): HealthAuthReadiness {
  const browserClientIdConfigured = hasConfiguredEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID');
  const serverAudienceConfigured =
    hasConfiguredEnv('GOOGLE_CLIENT_ID') || browserClientIdConfigured;

  return {
    browserClientIdConfigured,
    serverAudienceConfigured,
    ...createReadyCheck(
      browserClientIdConfigured && serverAudienceConfigured,
      'Google sign-in is missing a browser client ID or server audience',
    ),
  };
}

function getEncryptionReadiness(): HealthEncryptionReadiness {
  const configured = hasEncryptionKeyConfigured();
  return {
    configured,
    ...createReadyCheck(
      configured,
      'RAIC_SECRET_ENCRYPTION_KEY is not configured for server-backed secret storage',
    ),
  };
}

function getMiroFishReadiness(): HealthMiroFishReadiness {
  const baseUrlConfigured = hasConfiguredEnv('MIROFISH_BASE_URL');
  const apiBaseUrlConfigured = hasConfiguredEnv('MIROFISH_API_BASE_URL') || baseUrlConfigured;
  const apiAccessConfigured = hasConfiguredEnv('MIROFISH_API_KEY');
  const embedSigningConfigured = hasConfiguredEnv('MIROFISH_EMBED_SECRET');
  const multiUserEnabled = isMiroFishMultiUserEnabled();

  if (!baseUrlConfigured) {
    return {
      baseUrlConfigured,
      apiBaseUrlConfigured,
      apiAccessConfigured,
      embedSigningConfigured,
      multiUserEnabled,
      ...createReadyCheck(false, 'MIROFISH_BASE_URL is not configured'),
    };
  }

  try {
    getMiroFishConfig();
  } catch (error) {
    return {
      baseUrlConfigured,
      apiBaseUrlConfigured,
      apiAccessConfigured,
      embedSigningConfigured,
      multiUserEnabled,
      ...createReadyCheck(
        false,
        error instanceof Error ? error.message : 'MiroFish configuration is invalid',
      ),
    };
  }

  return {
    baseUrlConfigured,
    apiBaseUrlConfigured,
    apiAccessConfigured,
    embedSigningConfigured,
    multiUserEnabled,
    ...createReadyCheck(
      apiAccessConfigured && embedSigningConfigured,
      'MiroFish API validation or embed signing is not fully configured',
    ),
  };
}

export async function getHealthReadiness(): Promise<HealthReadinessReport> {
  const [storage, auth, encryption] = await Promise.all([
    getStorageReadiness(),
    Promise.resolve(getAuthReadiness()),
    Promise.resolve(getEncryptionReadiness()),
  ]);

  return {
    auth,
    encryption,
    storage,
    mirofish: getMiroFishReadiness(),
  };
}

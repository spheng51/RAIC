import type { ProviderId } from '@/lib/ai/providers';
import type { ProviderTransportMode } from '@/lib/types/provider';

export function supportsBrowserLocalTransport(providerId?: ProviderId | null): boolean {
  return providerId === 'lmstudio' || providerId === 'ollama';
}

export function normalizeProviderTransportMode(
  providerId?: ProviderId | null,
  transportMode?: ProviderTransportMode | null,
): ProviderTransportMode {
  if (supportsBrowserLocalTransport(providerId) && transportMode === 'browser-local') {
    return 'browser-local';
  }

  return 'server';
}

export function isBrowserLocalTransport(
  providerId?: ProviderId | null,
  transportMode?: ProviderTransportMode | null,
): boolean {
  return normalizeProviderTransportMode(providerId, transportMode) === 'browser-local';
}

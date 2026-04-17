import { useSettingsStore } from '@/lib/store/settings';
import { normalizeProviderTransportMode } from '@/lib/utils/provider-transport';

/**
 * Get current model configuration from settings store
 */
export function getCurrentModelConfig() {
  const { providerId, modelId, providersConfig } = useSettingsStore.getState();
  const modelString = `${providerId}:${modelId}`;

  // Get current provider's config
  const providerConfig = providersConfig[providerId];
  const effectiveBaseUrl =
    providerConfig?.baseUrl ||
    providerConfig?.serverBaseUrl ||
    providerConfig?.defaultBaseUrl ||
    '';
  const transportMode = normalizeProviderTransportMode(providerId, providerConfig?.transportMode);

  return {
    providerId,
    providerName: providerConfig?.name || providerId,
    modelId,
    modelString,
    apiKey: providerConfig?.apiKey || '',
    baseUrl: providerConfig?.baseUrl || '',
    effectiveBaseUrl,
    providerType: providerConfig?.type,
    requiresApiKey: providerConfig?.requiresApiKey,
    isServerConfigured: providerConfig?.isServerConfigured,
    transportMode,
  };
}

import { getProvider, parseModelString } from '@/lib/ai/providers';
import {
  hasHostedLocalProviderTopologyMismatch,
  isLocalOnlyProvider,
  isLocalOrPrivateBaseUrl,
} from '@/lib/utils/url';

const RAW_LOCAL_NETWORK_ERROR = 'Local/private network URLs are not allowed';

function getLocalProviderEnvName(providerId: string): string {
  if (providerId === 'ollama') {
    return 'OLLAMA_BASE_URL';
  }
  return 'LMSTUDIO_BASE_URL';
}

function getHostedLocalProviderMessage(providerName: string): string {
  return `Hosted Open-RAIC cannot reach your local ${providerName} server at a localhost/private address. This app sends provider traffic from the server, not your browser. Use local Open-RAIC, private self-hosting on the same machine or network, or a network-reachable endpoint instead.`;
}

function getPrivateDeploymentLocalProviderMessage(
  providerId: string,
  providerName: string,
): string {
  const envName = getLocalProviderEnvName(providerId);
  return `Open-RAIC cannot use a browser-supplied localhost/private address for ${providerName} in this deployment. If you are running locally, make sure ${providerName} is running. For private/self-host production, prefer ${envName} or server-providers.yml on the server, and set ALLOW_LOCAL_NETWORKS=true only when browser-supplied local URLs must be allowed.`;
}

export function remapModelVerificationError(params: {
  modelString?: string;
  baseUrl?: string;
  requestHostname?: string;
  errorMessage: string;
}): string | null {
  if (!params.modelString) {
    return null;
  }

  const { providerId } = parseModelString(params.modelString);
  if (!isLocalOnlyProvider(providerId)) {
    return null;
  }

  const provider = getProvider(providerId);
  const providerName = provider?.name || providerId;
  const effectiveBaseUrl = params.baseUrl || provider?.defaultBaseUrl;
  if (!isLocalOrPrivateBaseUrl(effectiveBaseUrl)) {
    return null;
  }

  if (
    hasHostedLocalProviderTopologyMismatch({
      providerId,
      originHostname: params.requestHostname,
      baseUrl: effectiveBaseUrl,
    })
  ) {
    return getHostedLocalProviderMessage(providerName);
  }

  const normalizedError = params.errorMessage.toLowerCase();
  if (
    params.errorMessage === RAW_LOCAL_NETWORK_ERROR ||
    normalizedError.includes('econnrefused') ||
    normalizedError.includes('enotfound')
  ) {
    return getPrivateDeploymentLocalProviderMessage(providerId, providerName);
  }

  return null;
}

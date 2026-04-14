import type { SpeechAction } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';

interface SceneTTSProviderConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly customDefaultBaseUrl?: string;
  readonly modelId?: string;
}

export interface SceneSpeechPrefetchSettings {
  readonly ttsEnabled: boolean;
  readonly ttsProviderId: string;
  readonly ttsVoice: string;
  readonly ttsSpeed: number;
  readonly ttsProvidersConfig?: Record<string, SceneTTSProviderConfig | undefined>;
}

export interface SceneSpeechPrefetchMessages {
  readonly speechFailed: string;
}

export interface PrefetchedSceneAudioFile {
  readonly id: string;
  readonly blob: Blob;
  readonly format: string;
  readonly createdAt: number;
}

export interface SceneSpeechPrefetchDependencies {
  readonly fetchImpl?: typeof fetch;
  readonly storeAudioFile: (file: PrefetchedSceneAudioFile) => Promise<void>;
  readonly warn?: (...args: unknown[]) => void;
  readonly now?: () => number;
}

export interface SceneSpeechPrefetchResult {
  readonly failedCount: number;
  readonly warningMessage: string | null;
}

interface TTSApiResponse {
  readonly success?: boolean;
  readonly base64?: string;
  readonly format?: string;
  readonly error?: string;
  readonly details?: string;
}

function getSpeechActions(scene: Scene): SpeechAction[] {
  return (scene.actions || []).filter(
    (action): action is SpeechAction => action.type === 'speech' && !!action.text,
  );
}

function decodeBase64Audio(base64: string, format: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: `audio/${format}` });
}

export async function prefetchSceneSpeechAudio(params: {
  readonly scene: Scene;
  readonly settings: SceneSpeechPrefetchSettings;
  readonly messages: SceneSpeechPrefetchMessages;
  readonly signal?: AbortSignal;
  readonly deps: SceneSpeechPrefetchDependencies;
}): Promise<SceneSpeechPrefetchResult> {
  const { scene, settings, messages, signal, deps } = params;

  if (!settings.ttsEnabled || settings.ttsProviderId === 'browser-native-tts') {
    return { failedCount: 0, warningMessage: null };
  }

  const speechActions = getSpeechActions(scene);
  if (speechActions.length === 0) {
    return { failedCount: 0, warningMessage: null };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const providerConfig = settings.ttsProvidersConfig?.[settings.ttsProviderId];

  let failedCount = 0;
  let lastError: string | null = null;

  for (const action of speechActions) {
    const audioId = `tts_${action.id}`;
    action.audioId = audioId;

    try {
      const response = await fetchImpl('/api/generate/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: action.text,
          audioId,
          ttsProviderId: settings.ttsProviderId,
          ttsModelId: providerConfig?.modelId,
          ttsVoice: settings.ttsVoice,
          ttsSpeed: settings.ttsSpeed,
          ttsApiKey: providerConfig?.apiKey || undefined,
          ttsBaseUrl: providerConfig?.baseUrl || providerConfig?.customDefaultBaseUrl || undefined,
        }),
        signal,
      });

      if (!response.ok) {
        const errorData = (await response
          .json()
          .catch(() => ({
            error: `TTS request failed: HTTP ${response.status}`,
          }))) as TTSApiResponse;
        lastError =
          errorData.error || errorData.details || `TTS request failed: HTTP ${response.status}`;
        failedCount++;
        continue;
      }

      const ttsData = (await response.json()) as TTSApiResponse;
      if (!ttsData.success || !ttsData.base64 || !ttsData.format) {
        lastError = ttsData.error || ttsData.details || messages.speechFailed;
        failedCount++;
        continue;
      }

      await deps.storeAudioFile({
        id: audioId,
        blob: decodeBase64Audio(ttsData.base64, ttsData.format),
        format: ttsData.format,
        createdAt: now(),
      });
    } catch (error) {
      deps.warn?.(`[TTS] Failed for ${audioId}:`, error);
      lastError = error instanceof Error ? error.message : String(error);
      failedCount++;
    }
  }

  if (failedCount > 0) {
    deps.warn?.(
      '[GenerationPreview] Continuing without pre-generated speech audio after TTS failures',
      {
        providerId: settings.ttsProviderId,
        failedCount,
        totalCount: speechActions.length,
        error: lastError,
      },
    );

    return {
      failedCount,
      warningMessage: messages.speechFailed,
    };
  }

  return { failedCount: 0, warningMessage: null };
}

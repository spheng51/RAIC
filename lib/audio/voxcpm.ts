import type { TTSVoiceInfo } from '@/lib/audio/types';

export const VOXCPM_TTS_PROVIDER_ID = 'voxcpm-tts' as const;
export const VOXCPM_MODEL_ID = 'VoxCPM2';
export const VOXCPM_VLLM_MODEL_ID = 'voxcpm2';
export const VOXCPM_AUTO_VOICE_ID = 'voxcpm:auto';

export const VOXCPM_BACKENDS = [
  {
    id: 'vllm-omni',
    name: 'vLLM-Omni',
    endpoint: '/v1/audio/speech',
    description: 'OpenAI-compatible speech endpoint',
  },
  {
    id: 'python-api',
    name: 'Python API',
    endpoint: '/tts/upload',
    description: 'FastAPI deployment backed by the VoxCPM Python runtime',
  },
  {
    id: 'nano-vllm',
    name: 'Nano-vLLM',
    endpoint: '/generate',
    description: 'Nano-vLLM VoxCPM FastAPI deployment',
  },
] as const;

export type VoxCPMBackendType = (typeof VOXCPM_BACKENDS)[number]['id'];

export const DEFAULT_VOXCPM_BACKEND: VoxCPMBackendType = 'vllm-omni';

export interface VoxCPMProviderOptions {
  backend?: VoxCPMBackendType;
  voiceMode?: 'auto' | 'prompt' | 'clone';
  voicePrompt?: string;
  promptText?: string;
  referenceAudioBase64?: string;
  referenceAudioMimeType?: string;
  referenceAudioName?: string;
  cfgValue?: number;
  inferenceTimesteps?: number;
  normalize?: boolean;
  denoise?: boolean;
}

export const VOXCPM_AUTO_VOICE: TTSVoiceInfo = {
  id: VOXCPM_AUTO_VOICE_ID,
  name: 'Auto Voice',
  language: 'auto',
  gender: 'neutral',
  description: 'Generate a voice prompt from agent metadata',
};

export function normalizeVoxCPMBackend(value: unknown): VoxCPMBackendType {
  return VOXCPM_BACKENDS.some((backend) => backend.id === value)
    ? (value as VoxCPMBackendType)
    : DEFAULT_VOXCPM_BACKEND;
}

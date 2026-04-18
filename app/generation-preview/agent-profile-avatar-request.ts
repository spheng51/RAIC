import { SPECIALIST_AVATAR_GENERATION_REQUEST } from '@/lib/constants/specialist-avatar-catalog';

interface VoiceOption {
  readonly providerId: string;
  readonly voiceId: string;
  readonly voiceName: string;
}

interface StageInfo {
  readonly name: string;
  readonly description?: string;
}

export function buildGenerationPreviewAgentProfilesRequest(
  stageInfo: StageInfo,
  language: string,
  availableVoices: VoiceOption[],
) {
  return {
    stageInfo,
    language,
    ...SPECIALIST_AVATAR_GENERATION_REQUEST,
    availableVoices,
  };
}

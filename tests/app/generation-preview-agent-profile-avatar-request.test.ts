import { describe, expect, it } from 'vitest';
import { buildGenerationPreviewAgentProfilesRequest } from '@/app/generation-preview/agent-profile-avatar-request';
import { SPECIALIST_AVATAR_GENERATION_REQUEST } from '@/lib/constants/specialist-avatar-catalog';

describe('generation preview agent-profile avatar request', () => {
  it('uses the shared specialist avatar paths and descriptions', () => {
    const availableVoices = [
      {
        providerId: 'test-provider',
        voiceId: 'voice-1',
        voiceName: 'Voice One',
      },
    ];

    const payload = buildGenerationPreviewAgentProfilesRequest(
      { name: 'Physics 101', description: 'Intro class' },
      'en-US',
      availableVoices,
    );

    expect(payload).toEqual({
      stageInfo: { name: 'Physics 101', description: 'Intro class' },
      language: 'en-US',
      ...SPECIALIST_AVATAR_GENERATION_REQUEST,
      availableVoices,
    });
  });
});

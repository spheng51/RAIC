import { describe, expect, it } from 'vitest';
import { AGENT_DEFAULT_AVATARS } from '@/lib/constants/agent-defaults';
import { AVATAR_OPTIONS } from '@/lib/store/user-profile';
import {
  SPECIALIST_AVATAR_GENERATION_PREVIEW_DESCRIPTIONS,
  SPECIALIST_AVATAR_GENERATION_REQUEST,
  SPECIALIST_AVATAR_PATHS,
} from '@/lib/constants/specialist-avatar-catalog';

describe('specialist avatar catalog', () => {
  it('keeps generated defaults and the profile picker aligned to the shared specialist catalog', () => {
    expect(AGENT_DEFAULT_AVATARS).toEqual(SPECIALIST_AVATAR_PATHS);
    expect(AVATAR_OPTIONS).toEqual(SPECIALIST_AVATAR_PATHS);
  });

  it('keeps the shared generation request payload aligned to the shared specialist catalog', () => {
    expect(SPECIALIST_AVATAR_GENERATION_REQUEST.availableAvatars).toEqual(SPECIALIST_AVATAR_PATHS);
    expect(SPECIALIST_AVATAR_GENERATION_REQUEST.avatarDescriptions).toEqual(
      SPECIALIST_AVATAR_GENERATION_PREVIEW_DESCRIPTIONS,
    );
  });
});

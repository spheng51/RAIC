import { describe, expect, it } from 'vitest';
import { AGENT_DEFAULT_AVATARS } from '@/lib/constants/agent-defaults';
import { AVATAR_OPTIONS } from '@/lib/store/user-profile';
import {
  SPECIALIST_AVATAR_CATALOG,
  SPECIALIST_AVATAR_GENERATION_PREVIEW_DESCRIPTIONS,
  SPECIALIST_AVATAR_GENERATION_REQUEST,
  SPECIALIST_AVATAR_NAME_GUIDANCE,
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
    expect(SPECIALIST_AVATAR_GENERATION_REQUEST.avatarNameGuidance).toEqual(
      SPECIALIST_AVATAR_NAME_GUIDANCE,
    );
  });

  it('defines internal naming guidance for every specialist avatar', () => {
    const validNameGenders = new Set(['masculine', 'feminine', 'neutral']);
    const genderByPath = Object.fromEntries(
      SPECIALIST_AVATAR_NAME_GUIDANCE.map((avatar) => [avatar.path, avatar.nameGender]),
    );

    expect(SPECIALIST_AVATAR_CATALOG).toHaveLength(SPECIALIST_AVATAR_PATHS.length);
    expect(SPECIALIST_AVATAR_NAME_GUIDANCE).toHaveLength(SPECIALIST_AVATAR_PATHS.length);
    expect(genderByPath).toMatchObject({
      '/avatars/principal.png': 'masculine',
      '/avatars/librarian.png': 'feminine',
      '/avatars/counselor.png': 'masculine',
      '/avatars/coach.png': 'masculine',
      '/avatars/nurse.png': 'feminine',
      '/avatars/artist.png': 'neutral',
      '/avatars/scientist.png': 'masculine',
      '/avatars/musician.png': 'neutral',
      '/avatars/debate-captain.png': 'masculine',
      '/avatars/coder-club.png': 'masculine',
    });

    for (const avatar of SPECIALIST_AVATAR_CATALOG) {
      expect(SPECIALIST_AVATAR_PATHS).toContain(avatar.path);
      expect(avatar.generationPreviewDescription.length).toBeGreaterThan(20);
      expect(validNameGenders.has(avatar.nameGender)).toBe(true);
      expect(avatar.nameGuidance.length).toBeGreaterThan(20);
    }
  });
});

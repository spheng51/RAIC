/**
 * Ordered catalog of specialist avatars shared across generation flows.
 *
 * The array order defines the shared specialist fallback rotation for
 * generated agents, the profile picker, and generation-preview requests.
 */
export type SpecialistAvatarNameGender = 'masculine' | 'feminine' | 'neutral';

type SpecialistAvatarCatalogEntry = {
  readonly path: string;
  readonly generationPreviewDescription: string;
  readonly nameGender: SpecialistAvatarNameGender;
  readonly nameGuidance: string;
};

export const SPECIALIST_AVATAR_CATALOG = [
  {
    path: '/avatars/principal.png',
    generationPreviewDescription:
      'Confident principal in burgundy-and-gold with a clipboard, lapel badge, and leadership vibe',
    nameGender: 'masculine',
    nameGuidance:
      'Use a culturally appropriate masculine name for the requested language and educator role.',
  },
  {
    path: '/avatars/librarian.png',
    generationPreviewDescription:
      'Friendly librarian in forest green holding books with warm library shelves and bookmark motifs',
    nameGender: 'feminine',
    nameGuidance:
      'Use a culturally appropriate feminine name for the requested language and professional role.',
  },
  {
    path: '/avatars/counselor.png',
    generationPreviewDescription:
      'Supportive counselor in teal-and-peach with a notepad, speech bubbles, and caring calm energy',
    nameGender: 'masculine',
    nameGuidance:
      'Use a culturally appropriate masculine name for the requested language and counselor role.',
  },
  {
    path: '/avatars/coach.png',
    generationPreviewDescription:
      'Energetic coach in red-and-navy with a stopwatch, whistle, clipboard, and track-team flair',
    nameGender: 'masculine',
    nameGuidance:
      'Use a culturally appropriate masculine name for the requested language and coach role.',
  },
  {
    path: '/avatars/nurse.png',
    generationPreviewDescription:
      'Reassuring school nurse in aqua-and-coral with a first-aid cue and playful health-check motifs',
    nameGender: 'feminine',
    nameGuidance:
      'Use a culturally appropriate feminine name for the requested language and healthcare role.',
  },
  {
    path: '/avatars/artist.png',
    generationPreviewDescription:
      'Creative student artist in violet-and-sunflower tones with a brush, palette, and sketchbook',
    nameGender: 'neutral',
    nameGuidance:
      'Prefer a gender-neutral, character-style, or role-based name that fits a creative student.',
  },
  {
    path: '/avatars/scientist.png',
    generationPreviewDescription:
      'Excited student scientist in lime-and-cyan with goggles, a flask, and atom-style lab shapes',
    nameGender: 'masculine',
    nameGuidance:
      'Use a culturally appropriate masculine name for the requested language and science persona.',
  },
  {
    path: '/avatars/musician.png',
    generationPreviewDescription:
      'Joyful student musician in indigo-and-hot-pink with headphones, microphone, and music-note energy',
    nameGender: 'neutral',
    nameGuidance:
      'Prefer a gender-neutral, character-style, or role-based name that fits a music persona.',
  },
  {
    path: '/avatars/debate-captain.png',
    generationPreviewDescription:
      'Confident debate captain in cobalt-and-crimson with a microphone, speech cards, and spotlight rays',
    nameGender: 'masculine',
    nameGuidance:
      'Use a culturally appropriate masculine name for the requested language and debate persona.',
  },
  {
    path: '/avatars/coder-club.png',
    generationPreviewDescription:
      'Bright coder-club student in electric blue and neon green with a laptop, code symbols, and digital sparks',
    nameGender: 'masculine',
    nameGuidance:
      'Use a culturally appropriate masculine name for the requested language and coding persona.',
  },
] as const satisfies readonly SpecialistAvatarCatalogEntry[];

export type SpecialistAvatarPath = (typeof SPECIALIST_AVATAR_CATALOG)[number]['path'];

export const SPECIALIST_AVATAR_PATHS = SPECIALIST_AVATAR_CATALOG.map(
  (avatar) => avatar.path,
) as readonly SpecialistAvatarPath[];

export const SPECIALIST_AVATAR_GENERATION_PREVIEW_DESCRIPTIONS = SPECIALIST_AVATAR_CATALOG.map(
  ({ path, generationPreviewDescription }) => ({
    path,
    desc: generationPreviewDescription,
  }),
) as ReadonlyArray<{
  readonly path: SpecialistAvatarPath;
  readonly desc: string;
}>;

export const SPECIALIST_AVATAR_NAME_GUIDANCE = SPECIALIST_AVATAR_CATALOG.map(
  ({ path, nameGender, nameGuidance }) => ({
    path,
    nameGender,
    nameGuidance,
  }),
) as ReadonlyArray<{
  readonly path: SpecialistAvatarPath;
  readonly nameGender: SpecialistAvatarNameGender;
  readonly nameGuidance: string;
}>;

export const SPECIALIST_AVATAR_GENERATION_REQUEST = {
  availableAvatars: SPECIALIST_AVATAR_PATHS,
  avatarDescriptions: SPECIALIST_AVATAR_GENERATION_PREVIEW_DESCRIPTIONS,
  avatarNameGuidance: SPECIALIST_AVATAR_NAME_GUIDANCE,
} as const;

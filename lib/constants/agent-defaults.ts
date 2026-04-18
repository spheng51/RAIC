/**
 * Shared constants for agent profile generation.
 *
 * Used by both the client-side agent-profiles API route and the
 * server-side classroom-generation pipeline to keep colors / avatars in sync.
 */

/** Color palette cycled for generated agents */
export const AGENT_COLOR_PALETTE = [
  '#2563eb',
  '#fb7185',
  '#f97316',
  '#ec4899',
  '#06b6d4',
  '#6366f1',
  '#14b8a6',
  '#84cc16',
  '#e11d48',
  '#a855f7',
  '#3b82f6',
  '#10b981',
] as const;

/**
 * Default avatar paths cycled for generated agents.
 *
 * Every entry MUST correspond to a file that exists under `public/avatars/`.
 */
export const AGENT_DEFAULT_AVATARS = [
  '/avatars/teacher-kids.png',
  '/avatars/assist-kids.png',
  '/avatars/clown-kids.png',
  '/avatars/curious-kids.png',
  '/avatars/note-taker-kids.png',
  '/avatars/thinker-kids.png',
  '/avatars/librarian.png',
  '/avatars/principal.png',
  '/avatars/coach.png',
  '/avatars/counselor.png',
  '/avatars/teacher-2.png',
  '/avatars/assist-2.png',
  '/avatars/clown-2.png',
  '/avatars/curious-2.png',
  '/avatars/note-taker-2.png',
  '/avatars/thinker-2.png',
] as const;

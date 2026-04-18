/**
 * Shared constants for agent profile generation.
 *
 * Used by both the client-side agent-profiles API route and the
 * server-side classroom-generation pipeline to keep colors / avatars in sync.
 */

import { SPECIALIST_AVATAR_PATHS } from './specialist-avatar-catalog';

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
export const AGENT_DEFAULT_AVATARS = SPECIALIST_AVATAR_PATHS;

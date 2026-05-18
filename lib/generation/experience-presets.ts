import type { ExperiencePreset } from '@/lib/types/generation';

export const HISTORICAL_VLOGGER_PRESET: ExperiencePreset = 'historical-vlogger';

export type ExperiencePresetSourceRequirement = 'none' | 'source-context';

export interface ExperiencePresetDefinition {
  id: ExperiencePreset;
  labelKey: string;
  hintKey: string;
  sourceRequirement: ExperiencePresetSourceRequirement;
  sourceRequiredMessage: string;
  sourceUnavailableMessage: string;
  promptContext: string;
}

const HISTORICAL_VLOGGER_PROMPT_CONTEXT = `## Historical Vlogger Experience Preset

Design this as a fictional time-traveler/vlogger classroom experience while still using the normal scene types. The guide may speak in first person as an on-the-ground observer, but must never claim impossible certainty or firsthand evidence.

Required treatment:
- Separate verified facts, plausible reconstruction, and AI visual limitations. Use explicit labels such as "Verified", "Reconstruction", "Source check", and "AI caveat" where they fit naturally.
- Include at least one fact-check or critical media-literacy moment that explains what is source-backed, what is inferred, and how viewers should evaluate AI reconstruction.
- Cite source titles, URLs, PDF names, or excerpt labels already present in the provided web/PDF context. Do not invent citations, URLs, dates, archives, witnesses, quotations, or source labels.
- Avoid sensationalized historical trauma. Keep emotionally vivid narration humane, accurate, and age-appropriate.
- Prefer normal slide, quiz, and optional interactive scenes. Use fact-check callouts, source labels, discussion prompts, and source-literacy quiz questions instead of a custom renderer.
- When creating quizzes, include at least one source-literacy question when the scene scope allows it.`;

export const EXPERIENCE_PRESET_DEFINITIONS: Record<ExperiencePreset, ExperiencePresetDefinition> = {
  [HISTORICAL_VLOGGER_PRESET]: {
    id: HISTORICAL_VLOGGER_PRESET,
    labelKey: 'toolbar.historyVlogPreset',
    hintKey: 'toolbar.historyVlogPresetHint',
    sourceRequirement: 'source-context',
    sourceRequiredMessage:
      'History Vlog requires configured web search or an uploaded PDF/source document.',
    sourceUnavailableMessage:
      'History Vlog needs usable source context. Enable working web search or upload a PDF/source document before generating.',
    promptContext: HISTORICAL_VLOGGER_PROMPT_CONTEXT,
  },
};

export const HISTORY_VLOG_SOURCE_REQUIRED_MESSAGE =
  EXPERIENCE_PRESET_DEFINITIONS[HISTORICAL_VLOGGER_PRESET].sourceRequiredMessage;

export const HISTORY_VLOG_SOURCE_UNAVAILABLE_MESSAGE =
  EXPERIENCE_PRESET_DEFINITIONS[HISTORICAL_VLOGGER_PRESET].sourceUnavailableMessage;

export function getExperiencePresetDefinition(
  preset?: ExperiencePreset,
): ExperiencePresetDefinition | undefined {
  return preset ? EXPERIENCE_PRESET_DEFINITIONS[preset] : undefined;
}

export function getAvailableExperiencePresetDefinitions(): ExperiencePresetDefinition[] {
  return Object.values(EXPERIENCE_PRESET_DEFINITIONS);
}

export function buildExperiencePresetPromptContext(preset?: ExperiencePreset): string {
  return getExperiencePresetDefinition(preset)?.promptContext ?? '';
}

export function experiencePresetRequiresSource(preset?: ExperiencePreset): boolean {
  return getExperiencePresetDefinition(preset)?.sourceRequirement === 'source-context';
}

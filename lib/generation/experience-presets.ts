import type { ExperiencePreset } from '@/lib/types/generation';

export const HISTORICAL_VLOGGER_PRESET: ExperiencePreset = 'historical-vlogger';

export const HISTORY_VLOG_SOURCE_REQUIRED_MESSAGE =
  'History Vlog requires configured web search or an uploaded PDF/source document.';

export const HISTORY_VLOG_SOURCE_UNAVAILABLE_MESSAGE =
  'History Vlog needs usable source context. Enable working web search or upload a PDF/source document before generating.';

export function experiencePresetRequiresSource(preset?: ExperiencePreset): boolean {
  return preset === HISTORICAL_VLOGGER_PRESET;
}

export function buildExperiencePresetPromptContext(preset?: ExperiencePreset): string {
  if (preset !== HISTORICAL_VLOGGER_PRESET) {
    return '';
  }

  return `## Historical Vlogger Experience Preset

Design this as a fictional time-traveler/vlogger classroom experience while still using the normal scene types. The guide may speak in first person as an on-the-ground observer, but must never claim impossible certainty or firsthand evidence.

Required treatment:
- Separate verified facts, plausible reconstruction, and AI visual limitations. Use explicit labels such as "Verified", "Reconstruction", "Source check", and "AI caveat" where they fit naturally.
- Include at least one fact-check or critical media-literacy moment that explains what is source-backed, what is inferred, and how viewers should evaluate AI reconstruction.
- Cite source titles, URLs, PDF names, or excerpt labels already present in the provided web/PDF context. Do not invent citations, URLs, dates, archives, witnesses, quotations, or source labels.
- Avoid sensationalized historical trauma. Keep emotionally vivid narration humane, accurate, and age-appropriate.
- Prefer normal slide, quiz, and optional interactive scenes. Use fact-check callouts, source labels, discussion prompts, and source-literacy quiz questions instead of a custom renderer.
- When creating quizzes, include at least one source-literacy question when the scene scope allows it.`;
}

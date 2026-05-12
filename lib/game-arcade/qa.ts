import type { TeacherAction, WidgetConfig } from '@/lib/types/widgets';

export interface GameWidgetValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function hasElementTarget(html: string, target: string): boolean {
  if (!target.startsWith('#')) return true;
  const id = target.slice(1).replace(/["'\\]/g, '');
  return new RegExp(`id=["']${id}["']`, 'i').test(html);
}

export function validateGameWidgetHtml(
  html: string,
  widgetConfig?: WidgetConfig,
  teacherActions?: TeacherAction[],
): GameWidgetValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const htmlDocumentCount = countMatches(html, /<html[\s>]/gi);
  if (htmlDocumentCount !== 1 || countMatches(html, /<!doctype\s+html/gi) > 1) {
    errors.push('Game HTML must contain exactly one HTML document.');
  }

  const hasWidgetConfigScript =
    /<script(?=[^>]*\btype=["']application\/json["'])(?=[^>]*\bid=["']widget-config["'])[^>]*>/i.test(
      html,
    );
  if (!hasWidgetConfigScript) {
    errors.push('Game HTML must embed a widget-config JSON script.');
  }

  if (hasWidgetConfigScript && !widgetConfig) {
    errors.push('Game widget-config JSON must be parseable.');
  }

  if (widgetConfig && widgetConfig.type !== 'game') {
    errors.push('Game widget-config must use type "game".');
  }

  if (!/<(button|input)[^>]*(start|begin|play|launch)[^>]*>/i.test(html)) {
    errors.push('Game HTML must expose a start control.');
  }

  if (!/(score|status|progress|level|hud|points)/i.test(html)) {
    errors.push('Game HTML must expose score, status, progress, or level feedback.');
  }

  if (
    /(?:let|const|var)\s+(?:gameOver|failed|isFailed)\s*=\s*true\b/i.test(html) ||
    /data-initial-state=["'](?:failed|game-over)["']/i.test(html)
  ) {
    errors.push('Game HTML must not start in an immediate failure state.');
  }

  for (const action of teacherActions ?? []) {
    if (action.target && !hasElementTarget(html, action.target)) {
      warnings.push(`Teacher action target may be missing: ${action.target}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

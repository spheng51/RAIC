import type { UserRequirements } from '@/lib/types/generation';

export type CourseLanguage = UserRequirements['language'];

export interface CourseLanguageLabels {
  language: CourseLanguage;
  courseLanguageName: string;
  htmlLang: string;
  startLabel: string;
  restartLabel: string;
  hintLabel: string;
  scoreLabel: string;
  statusLabel: string;
  progressLabel: string;
  pauseLabel: string;
  resumeLabel: string;
}

const ENGLISH_LABELS: CourseLanguageLabels = {
  language: 'en-US',
  courseLanguageName: 'English',
  htmlLang: 'en-US',
  startLabel: 'Start Game',
  restartLabel: 'Restart',
  hintLabel: 'Hint',
  scoreLabel: 'Score',
  statusLabel: 'Status',
  progressLabel: 'Progress',
  pauseLabel: 'Pause',
  resumeLabel: 'Resume',
};

const CHINESE_LABELS: CourseLanguageLabels = {
  language: 'zh-CN',
  courseLanguageName: 'Simplified Chinese',
  htmlLang: 'zh-CN',
  startLabel: '开始游戏',
  restartLabel: '重新开始',
  hintLabel: '提示',
  scoreLabel: '分数',
  statusLabel: '状态',
  progressLabel: '进度',
  pauseLabel: '暂停',
  resumeLabel: '继续',
};

export function getCourseLanguageLabels(language?: CourseLanguage): CourseLanguageLabels {
  return language === 'zh-CN' ? CHINESE_LABELS : ENGLISH_LABELS;
}

export function buildCourseLanguageDirective(language?: CourseLanguage): string {
  const labels = getCourseLanguageLabels(language);
  return [
    `All generated classroom content must be written in ${labels.courseLanguageName}.`,
    `This includes slide text, quiz text, game/widget iframe HTML, visible UI labels, button text, HUD/status/progress text, annotations, teacher action labels, and narration.`,
    `Set generated iframe documents to lang="${labels.htmlLang}" when producing HTML.`,
    'Use another language only when quoting source material, showing code identifiers/API names, or explicitly teaching a translation.',
  ].join(' ');
}

export const DEFAULT_LANGUAGE_DIRECTIVE = buildCourseLanguageDirective('en-US');

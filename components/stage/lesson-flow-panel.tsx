'use client';

import {
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  Circle,
  FileText,
  Languages,
  Search,
  Target,
} from 'lucide-react';
import {
  LESSON_STAGE_IDS,
  type ClassroomLessonState,
  type LessonStageId,
} from '@/lib/classroom/lesson-state';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';

interface LessonFlowPanelProps {
  readonly lessonState: ClassroomLessonState;
  readonly currentSceneTitle?: string | null;
  readonly currentSceneNumber: number;
  readonly totalScenesCount: number;
}

function stageKey(stageId: LessonStageId): string {
  return `classroom.lesson.stages.${stageId}`;
}

function shortModelName(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return 'current classroom model';
  return trimmed.length > 36 ? `${trimmed.slice(0, 33)}...` : trimmed;
}

function formatLanguage(language: string): string {
  if (language === 'zh-CN') return '中文';
  if (language === 'en-US') return 'English';
  return language;
}

export function LessonFlowPanel({
  lessonState,
  currentSceneTitle,
  currentSceneNumber,
  totalScenesCount,
}: LessonFlowPanelProps) {
  const { t } = useI18n();
  const completed = new Set(lessonState.completedStages);
  const source = lessonState.sourceContext;
  const sceneProgress = t('classroom.lesson.sceneProgress', {
    current: Math.max(currentSceneNumber, 1),
    total: Math.max(totalScenesCount, 1),
  });

  return (
    <section
      data-testid="lesson-flow-panel"
      aria-label={t('classroom.lesson.progressAria')}
      className="shrink-0 border-y border-slate-200/70 bg-white/75 px-4 py-3 shadow-[0_1px_0_rgba(15,23,42,0.03)] backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/75 sm:px-6"
    >
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-900/70">
              <Target className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                <span>{t('classroom.lesson.goalLabel')}</span>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                  /
                </span>
                <span>{sceneProgress}</span>
              </div>
              <h2 className="mt-0.5 max-w-[74rem] truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                {lessonState.goal}
              </h2>
              {currentSceneTitle ? (
                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                  {currentSceneTitle}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 lg:justify-end">
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {source.pdfAttached
                  ? t('classroom.lesson.pdfAttached', {
                      name: source.pdfName || t('classroom.lesson.pdfDocument'),
                    })
                  : t('classroom.lesson.pdfMissing')}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              {source.tavilyEnabled
                ? t('classroom.lesson.webAvailable')
                : t('classroom.lesson.webDisabled')}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <Languages className="h-3.5 w-3.5" aria-hidden="true" />
              {t('classroom.lesson.languageLabel', {
                language: formatLanguage(source.language),
              })}
            </span>
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <BrainCircuit className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {t('classroom.lesson.modelLabel', {
                  model: shortModelName(source.selectedModel),
                })}
              </span>
            </span>
          </div>
        </div>

        <ol
          className="flex gap-2 overflow-x-auto pb-0.5"
          aria-label={t('classroom.lesson.stagesAria')}
        >
          {LESSON_STAGE_IDS.map((stageId) => {
            const isCurrent = lessonState.currentStage === stageId;
            const isComplete = completed.has(stageId);
            const label = t(stageKey(stageId));

            return (
              <li
                key={stageId}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'flex min-w-[8.5rem] items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors',
                  isCurrent
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-900 shadow-sm dark:border-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-100'
                    : isComplete
                      ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/45 dark:text-emerald-200'
                      : 'border-slate-200 bg-white/60 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400',
                )}
              >
                {isComplete ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : isCurrent ? (
                  <BookOpenCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span className="truncate font-semibold">{label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

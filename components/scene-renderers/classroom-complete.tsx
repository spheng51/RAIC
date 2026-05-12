'use client';

import { useMemo } from 'react';
import { CheckCircle2, FileText, HelpCircle, MonitorPlay, Puzzle, Trophy } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store';
import { summarizeScenes } from '@/lib/classroom/complete-summary';
import { readAnswersForSummary } from '@/lib/quiz/persistence';
import type { Scene, SceneType } from '@/lib/types/stage';

const sceneTypeIcons: Record<SceneType, typeof FileText> = {
  slide: FileText,
  quiz: HelpCircle,
  interactive: MonitorPlay,
  pbl: Puzzle,
};

const sceneTypeLabels: Record<'zh-CN' | 'en-US', Record<SceneType, string>> = {
  'zh-CN': {
    slide: '幻灯片',
    quiz: '测验',
    interactive: '互动',
    pbl: '项目',
  },
  'en-US': {
    slide: 'Slides',
    quiz: 'Quizzes',
    interactive: 'Interactives',
    pbl: 'Projects',
  },
};

function copy(locale: string) {
  const zh = locale === 'zh-CN';
  return {
    title: zh ? '课程完成' : 'Course complete',
    subtitle: zh
      ? '你已经走完整个课堂。做得漂亮。'
      : 'You made it through the whole classroom. Nicely done.',
    quizScore: zh ? '测验得分' : 'Quiz score',
    noQuiz: zh ? '本课程没有可自动汇总的选择题。' : 'No auto-graded quiz questions to summarize.',
    scenes: zh ? '学习足迹' : 'Learning trail',
    completed: zh ? '已完成' : 'Completed',
  };
}

export function ClassroomCompletePage({
  scenes,
  title,
}: {
  readonly scenes: Scene[];
  readonly title: string;
}) {
  const { locale } = useI18n();
  const labels = copy(locale);
  const typeLabels = sceneTypeLabels[locale === 'zh-CN' ? 'zh-CN' : 'en-US'];
  const summary = useMemo(() => summarizeScenes(scenes, readAnswersForSummary), [scenes]);
  const types = (['slide', 'quiz', 'interactive', 'pbl'] as SceneType[]).filter(
    (type) => (summary.countsByType[type] ?? 0) > 0,
  );

  return (
    <section className="absolute inset-0 z-[105] flex items-center justify-center overflow-auto bg-gradient-to-br from-amber-50 via-white to-sky-50 p-6 dark:from-gray-950 dark:via-gray-900 dark:to-slate-950">
      <div className="w-full max-w-2xl rounded-3xl border border-amber-100 bg-white/90 p-8 text-center shadow-2xl shadow-amber-200/30 backdrop-blur dark:border-amber-900/40 dark:bg-gray-900/90 dark:shadow-black/40">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-white shadow-lg shadow-amber-300/40">
          <Trophy className="h-10 w-10" />
        </div>

        <p className="mt-5 text-xs font-bold uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
          {labels.completed}
        </p>
        <h2 className="mt-2 text-3xl font-black text-gray-950 dark:text-white">
          {title || labels.title}
        </h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{labels.subtitle}</p>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-left dark:border-gray-800 dark:bg-gray-950/70">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              {labels.scenes}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {types.map((type) => {
                const Icon = sceneTypeIcons[type];
                return (
                  <div
                    key={type}
                    className="rounded-xl bg-white px-3 py-3 shadow-sm ring-1 ring-gray-100 dark:bg-gray-900 dark:ring-gray-800"
                  >
                    <Icon className="mb-2 h-4 w-4 text-amber-500" />
                    <div className="text-2xl font-black text-gray-900 dark:text-gray-100">
                      {summary.countsByType[type]}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {typeLabels[type]}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-left dark:border-amber-900/40 dark:bg-amber-950/20">
            <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {labels.quizScore}
            </div>
            {summary.quiz ? (
              <div className="mt-5 flex items-end gap-2">
                <span className="text-5xl font-black text-amber-700 dark:text-amber-300">
                  {summary.quiz.pct}%
                </span>
                <span className="pb-2 text-sm text-amber-700/70 dark:text-amber-300/70">
                  {summary.quiz.correct}/{summary.quiz.total}
                </span>
              </div>
            ) : (
              <p className="mt-5 text-sm text-amber-700/75 dark:text-amber-200/75">
                {labels.noQuiz}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ClassroomCompletePageConnected() {
  const stage = useStageStore((s) => s.stage);
  const scenes = useStageStore((s) => s.scenes);
  return <ClassroomCompletePage scenes={scenes} title={stage?.name ?? ''} />;
}

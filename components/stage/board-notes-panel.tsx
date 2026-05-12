'use client';

import { ClipboardList, Lightbulb, ListChecks, PencilLine } from 'lucide-react';
import { buildBoardNotes } from '@/lib/classroom/board-notes';
import type { ClassroomLessonState } from '@/lib/classroom/lesson-state';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { Scene } from '@/lib/types/stage';

interface BoardNotesPanelProps {
  readonly lessonState: ClassroomLessonState;
  readonly currentScene?: Scene | null;
}

export function BoardNotesPanel({ lessonState, currentScene }: BoardNotesPanelProps) {
  const { t } = useI18n();
  const notes = buildBoardNotes({ lessonState, currentScene });

  return (
    <section
      data-testid="board-notes-panel"
      aria-label={t('classroom.boardNotes.ariaLabel')}
      className="shrink-0 border-b border-slate-200/70 bg-slate-50/80 px-4 py-2.5 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/70 sm:px-6"
    >
      <div className="mx-auto grid max-w-[1600px] gap-2 text-xs text-slate-600 dark:text-slate-300 lg:grid-cols-[0.9fr_1.1fr_1.2fr_1fr]">
        <div className="flex min-w-0 items-start gap-2">
          <Lightbulb
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 drop-shadow-[0_1px_1px_rgba(120,53,15,0.3)] dark:text-amber-300"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {t('classroom.boardNotes.keyIdea')}
            </p>
            <p className="truncate">{notes.keyIdea}</p>
          </div>
        </div>

        <div className="flex min-w-0 items-start gap-2">
          <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {t('classroom.boardNotes.example')}
            </p>
            <p className="truncate">{notes.example}</p>
          </div>
        </div>

        <div className="flex min-w-0 items-start gap-2">
          <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {t('classroom.boardNotes.steps')}
            </p>
            <p className="truncate">{notes.steps.join(' / ')}</p>
          </div>
        </div>

        <div className="flex min-w-0 items-start gap-2">
          <PencilLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {t('classroom.boardNotes.practice')}
            </p>
            <p className="truncate">{notes.practicePrompt}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

'use client';

import { ExternalLink, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { ClassroomLiveMeeting } from '@/lib/types/stage';

interface StudentJoinLiveMeetingCardProps {
  readonly liveMeeting: ClassroomLiveMeeting;
}

export function StudentJoinLiveMeetingCard({ liveMeeting }: StudentJoinLiveMeetingCardProps) {
  const { t } = useI18n();
  const joinLabel = t('classroom.liveMeeting.joinZoom');

  return (
    <div className="space-y-3 rounded-xl border border-indigo-200/70 bg-indigo-50/70 p-4 text-indigo-900 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-100">
      <div className="flex items-start gap-3">
        <Video className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">
            {liveMeeting.label || t('classroom.liveMeeting.zoomLiveMeeting')}
          </p>
          <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-200/80">
            {t('classroom.liveMeeting.studentJoinDescription')}
          </p>
        </div>
      </div>
      <Button asChild variant="outline" className="w-full bg-background/80">
        <a href={liveMeeting.joinUrl} target="_blank" rel="noreferrer" aria-label={joinLabel}>
          <ExternalLink className="size-4" />
          {joinLabel}
        </a>
      </Button>
    </div>
  );
}

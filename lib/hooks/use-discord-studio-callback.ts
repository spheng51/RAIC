'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import type { ClassroomLaunchMode } from '@/lib/utils/classroom-launch';
import { getDiscordStudioCallbackFeedback } from '@/lib/utils/discord-studio-callback';

export function useDiscordStudioCallback(options: {
  launchMode: ClassroomLaunchMode;
  refreshConnection: () => void | Promise<void>;
  t: (key: string) => string;
}) {
  const { launchMode, refreshConnection, t } = options;

  useEffect(() => {
    if (launchMode !== 'teacher-server') {
      return;
    }

    const url = new URL(window.location.href);
    const discordCallbackStatus = url.searchParams.get('discord');
    if (!discordCallbackStatus) {
      return;
    }

    const feedback = getDiscordStudioCallbackFeedback(discordCallbackStatus);
    if (!feedback) {
      return;
    }

    if (feedback.toastKind === 'success') {
      toast.success(t(feedback.messageKey));
    } else {
      toast.error(t(feedback.messageKey));
    }

    if (feedback.shouldRefreshConnection) {
      void refreshConnection();
    }

    url.searchParams.delete('discord');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [launchMode, refreshConnection, t]);
}

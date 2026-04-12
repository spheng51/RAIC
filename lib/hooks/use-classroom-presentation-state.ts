'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { ClassroomPresentationStatePayload } from '@/lib/types/classroom-presentation';

const POLL_INTERVAL_MS = 1_500;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

interface UseClassroomPresentationStateOptions {
  readonly classroomId?: string;
  readonly onStateChange: (nextState: ClassroomPresentationStatePayload | null) => void;
}

export function useClassroomPresentationState({
  classroomId,
  onStateChange,
}: UseClassroomPresentationStateOptions) {
  const pollInFlightRef = useRef(false);

  const refreshPresentationState = useCallback(
    async (silent = false) => {
      if (!classroomId || pollInFlightRef.current) {
        return;
      }

      pollInFlightRef.current = true;
      try {
        const response = await fetch(
          `/api/classroom/${encodeURIComponent(classroomId)}/presentation-state`,
          {
            cache: 'no-store',
          },
        );
        const json = (await response.json().catch(() => null)) as
          | ({ success: true } & ClassroomPresentationStatePayload)
          | { success?: false; error?: string }
          | null;
        const errorMessage = json && 'error' in json ? json.error : undefined;

        if (!response.ok || !json?.success) {
          if (!silent) {
            throw new Error(errorMessage || 'Failed to refresh classroom presentation state.');
          }
          return;
        }

        onStateChange(json);
      } finally {
        pollInFlightRef.current = false;
      }
    },
    [classroomId, onStateChange],
  );

  useEffect(() => {
    if (!classroomId) {
      return;
    }

    let disposed = false;
    let retryIndex = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let eventSource: EventSource | null = null;

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const startPolling = () => {
      if (disposed || pollTimer) {
        return;
      }

      void refreshPresentationState(true);
      pollTimer = setInterval(() => {
        void refreshPresentationState(true);
      }, POLL_INTERVAL_MS);
    };

    const clearRetryTimer = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const closeEventSource = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    const connectEventSource = () => {
      if (disposed || typeof window === 'undefined' || !('EventSource' in window)) {
        startPolling();
        return;
      }

      closeEventSource();
      const source = new EventSource(
        `/api/classroom/${encodeURIComponent(classroomId)}/presentation-events`,
      );
      eventSource = source;

      source.addEventListener('open', () => {
        retryIndex = 0;
        stopPolling();
      });

      source.addEventListener('presentation-state', (event) => {
        const message = event as MessageEvent<string>;
        try {
          const payload = JSON.parse(message.data) as ClassroomPresentationStatePayload;
          onStateChange(payload);
          retryIndex = 0;
          stopPolling();
        } catch {
          // Ignore malformed events and let polling recover if needed.
        }
      });

      source.addEventListener('heartbeat', () => {
        stopPolling();
      });

      source.onerror = () => {
        closeEventSource();
        startPolling();

        if (disposed || retryTimer) {
          return;
        }

        const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
        retryIndex = Math.min(retryIndex + 1, RETRY_DELAYS_MS.length - 1);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          connectEventSource();
        }, delay);
      };
    };

    void refreshPresentationState(true);
    connectEventSource();

    return () => {
      disposed = true;
      clearRetryTimer();
      stopPolling();
      closeEventSource();
    };
  }, [classroomId, onStateChange, refreshPresentationState]);

  return {
    refreshPresentationState,
  };
}

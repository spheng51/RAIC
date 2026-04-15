'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { ClassroomCollaborationStatePayload } from '@/lib/types/classroom-collaboration';

const POLL_INTERVAL_MS = 1_500;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

interface UseClassroomCollaborationStateOptions {
  readonly classroomId?: string;
  readonly enabled?: boolean;
  readonly onStateChange: (nextState: ClassroomCollaborationStatePayload | null) => void;
}

export function useClassroomCollaborationState({
  classroomId,
  enabled = true,
  onStateChange,
}: UseClassroomCollaborationStateOptions) {
  const pollInFlightRef = useRef(false);
  const queuedRefreshSilentRef = useRef<boolean | null>(null);
  const lastStateRef = useRef<string | null>(null);
  const refreshCollaborationStateRef = useRef<(silent?: boolean) => Promise<void>>(
    async () => undefined,
  );

  const applyIfChanged = (nextState: ClassroomCollaborationStatePayload | null) => {
    if (!nextState) {
      return;
    }

    const payloadKey = JSON.stringify(nextState);
    if (payloadKey === lastStateRef.current) {
      return;
    }

    lastStateRef.current = payloadKey;
    onStateChange(nextState);
  };

  const refreshCollaborationState = useCallback(
    async (silent = false) => {
      if (!enabled || !classroomId) {
        return;
      }

      if (pollInFlightRef.current) {
        queuedRefreshSilentRef.current =
          queuedRefreshSilentRef.current === null
            ? silent
            : queuedRefreshSilentRef.current && silent;
        return;
      }

      pollInFlightRef.current = true;
      try {
        const response = await fetch(
          `/api/classroom/${encodeURIComponent(classroomId)}/collaboration-state`,
          {
            cache: 'no-store',
          },
        );
        const json = (await response.json().catch(() => null)) as
          | ({ success: true } & ClassroomCollaborationStatePayload)
          | { success?: false; error?: string }
          | null;
        const errorMessage = json && 'error' in json ? json.error : undefined;

        if (!response.ok || !json?.success) {
          if (!silent) {
            throw new Error(errorMessage || 'Failed to refresh classroom collaboration state.');
          }
          return;
        }

        applyIfChanged(json);
      } finally {
        pollInFlightRef.current = false;
        const queuedRefreshSilent = queuedRefreshSilentRef.current;
        if (queuedRefreshSilent !== null) {
          queuedRefreshSilentRef.current = null;
          void refreshCollaborationStateRef.current(queuedRefreshSilent);
        }
      }
    },
    [classroomId, enabled, onStateChange],
  );

  refreshCollaborationStateRef.current = refreshCollaborationState;

  useEffect(() => {
    if (!enabled || !classroomId) {
      return;
    }

    lastStateRef.current = null;

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

      void refreshCollaborationState(true);
      pollTimer = setInterval(() => {
        void refreshCollaborationState(true);
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
        `/api/classroom/${encodeURIComponent(classroomId)}/collaboration-events`,
      );
      eventSource = source;

      source.addEventListener('open', () => {
        retryIndex = 0;
        stopPolling();
      });

      source.addEventListener('collaboration-state', (event) => {
        const message = event as MessageEvent<string>;
        try {
          const payload = JSON.parse(message.data) as ClassroomCollaborationStatePayload;
          applyIfChanged(payload);
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

    void refreshCollaborationState(true);
    connectEventSource();

    return () => {
      disposed = true;
      clearRetryTimer();
      stopPolling();
      closeEventSource();
    };
  }, [classroomId, enabled, onStateChange, refreshCollaborationState]);

  return {
    refreshCollaborationState,
  };
}

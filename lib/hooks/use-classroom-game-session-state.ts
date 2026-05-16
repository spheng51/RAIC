'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { ClassroomGameSessionPayload } from '@/lib/types/classroom-game-session';

const POLL_INTERVAL_MS = 1_500;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

interface UseClassroomGameSessionStateOptions {
  readonly classroomId?: string;
  readonly enabled?: boolean;
  readonly onStateChange: (nextState: ClassroomGameSessionPayload | null) => void;
  readonly onFatalError?: (error: Error) => void;
}

export function useClassroomGameSessionState({
  classroomId,
  enabled = true,
  onStateChange,
  onFatalError,
}: UseClassroomGameSessionStateOptions) {
  const pollInFlightRef = useRef(false);
  const queuedRefreshSilentRef = useRef<boolean | null>(null);
  const lastStateRef = useRef<string | null>(null);
  const fatalErrorRef = useRef(false);
  const refreshGameSessionStateRef = useRef<(silent?: boolean) => Promise<void>>(
    async () => undefined,
  );

  const applyIfChanged = useCallback(
    (nextState: ClassroomGameSessionPayload | null) => {
      if (!nextState) {
        lastStateRef.current = null;
        onStateChange(null);
        return;
      }

      const payloadKey = JSON.stringify(nextState);
      if (payloadKey === lastStateRef.current) {
        return;
      }

      lastStateRef.current = payloadKey;
      onStateChange(nextState);
    },
    [onStateChange],
  );

  const refreshGameSessionState = useCallback(
    async (silent = false) => {
      if (!enabled || !classroomId || fatalErrorRef.current) {
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
          `/api/classroom/${encodeURIComponent(classroomId)}/game-session`,
          {
            cache: 'no-store',
          },
        );
        const json = (await response.json().catch(() => null)) as
          | ({ success: true } & ClassroomGameSessionPayload)
          | { success?: false; error?: string }
          | null;
        const errorMessage = json && 'error' in json ? json.error : undefined;

        if (response.status === 404) {
          const error = new Error(errorMessage || 'Classroom not found');
          fatalErrorRef.current = true;
          applyIfChanged(null);
          onFatalError?.(error);
          if (!silent) throw error;
          return;
        }

        if (!response.ok || !json?.success) {
          if (!silent) {
            throw new Error(errorMessage || 'Failed to refresh game session state.');
          }
          return;
        }

        applyIfChanged(json);
      } finally {
        pollInFlightRef.current = false;
        const queuedRefreshSilent = queuedRefreshSilentRef.current;
        if (queuedRefreshSilent !== null) {
          queuedRefreshSilentRef.current = null;
          void refreshGameSessionStateRef.current(queuedRefreshSilent);
        }
      }
    },
    [applyIfChanged, classroomId, enabled, onFatalError],
  );

  refreshGameSessionStateRef.current = refreshGameSessionState;

  useEffect(() => {
    if (!enabled || !classroomId) {
      return;
    }

    lastStateRef.current = null;
    fatalErrorRef.current = false;

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
      if (disposed || pollTimer || fatalErrorRef.current) return;
      void refreshGameSessionState(true);
      pollTimer = setInterval(() => {
        void refreshGameSessionState(true);
      }, POLL_INTERVAL_MS);
    };

    const closeEventSource = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    const connectEventSource = () => {
      if (
        disposed ||
        fatalErrorRef.current ||
        typeof window === 'undefined' ||
        !('EventSource' in window)
      ) {
        startPolling();
        return;
      }

      closeEventSource();
      const source = new EventSource(
        `/api/classroom/${encodeURIComponent(classroomId)}/game-session-events`,
      );
      eventSource = source;

      source.addEventListener('open', () => {
        retryIndex = 0;
        stopPolling();
      });
      source.addEventListener('game-session-state', (event) => {
        try {
          applyIfChanged(JSON.parse((event as MessageEvent<string>).data));
          retryIndex = 0;
          stopPolling();
        } catch {
          // Ignore malformed events and let polling recover.
        }
      });
      source.addEventListener('heartbeat', () => stopPolling());
      source.onerror = () => {
        closeEventSource();
        if (fatalErrorRef.current) {
          stopPolling();
          if (retryTimer) clearTimeout(retryTimer);
          return;
        }
        startPolling();
        if (disposed || retryTimer) return;
        const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
        retryIndex = Math.min(retryIndex + 1, RETRY_DELAYS_MS.length - 1);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          connectEventSource();
        }, delay);
      };
    };

    void refreshGameSessionState(true);
    connectEventSource();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      stopPolling();
      closeEventSource();
    };
  }, [applyIfChanged, classroomId, enabled, refreshGameSessionState]);

  return {
    refreshGameSessionState,
  };
}

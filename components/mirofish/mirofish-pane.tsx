'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Shield, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ClassroomCollaborationInteractionReason } from '@/lib/types/classroom-collaboration';
import type {
  PresentationSurface,
  SharedSimulationCollaborationMode,
  SharedSimulationCollaborationState,
  SharedSimulationStatus,
} from '@/lib/types/stage';
import { formatLeaseCountdown } from '@/lib/utils/classroom-presentation';

export interface MiroFishHostEvent {
  type: 'ready' | 'runStatus' | 'reportReady' | 'presenceSummary' | 'sessionStatus' | 'error';
  status?: SharedSimulationStatus;
  collaborationState?: SharedSimulationCollaborationState;
  participantCount?: number;
  message?: string;
}

interface MiroFishPaneProps {
  readonly activeSurface: Extract<PresentationSurface, 'simulation' | 'report'>;
  readonly simulationId: string;
  readonly reportId: string | null;
  readonly runUrl: string | null;
  readonly reportUrl: string | null;
  readonly collaborationMode: SharedSimulationCollaborationMode;
  readonly viewerCanInteract: boolean;
  readonly viewerCanManageSimulation: boolean;
  readonly collaborationState?: SharedSimulationCollaborationState | null;
  readonly viewerInteractionReason?: ClassroomCollaborationInteractionReason;
  readonly spotlightDisplayName?: string | null;
  readonly controllerRole: 'teacher' | 'student';
  readonly controllerDisplayName: string;
  readonly controlLeaseExpiresAt: string | null;
  readonly onEvent?: (event: MiroFishHostEvent) => void;
  readonly onReclaimControl?: () => void;
  readonly onRecoverToLesson?: (message: string) => void;
}

interface MiroFishPaneState {
  readonly sourceIdentity: string;
  readonly pinnedSrc: string | null;
  readonly frameState: 'loading' | 'ready' | 'error';
  readonly errorMessage: string | null;
  readonly reloadNonce: number;
}

function pickMiroFishSource(
  activeSurface: Extract<PresentationSurface, 'simulation' | 'report'>,
  runUrl: string | null,
  reportUrl: string | null,
) {
  return activeSurface === 'report' ? reportUrl : runUrl;
}

function getMiroFishSourceIdentity(
  activeSurface: Extract<PresentationSurface, 'simulation' | 'report'>,
  simulationId: string,
  reportId: string | null,
) {
  return activeSurface === 'report'
    ? `report:${simulationId}:${reportId ?? 'no-report'}`
    : `simulation:${simulationId}`;
}

function createMiroFishPaneState(
  sourceIdentity: string,
  nextSource: string | null,
): MiroFishPaneState {
  return {
    sourceIdentity,
    pinnedSrc: nextSource,
    frameState: 'loading',
    errorMessage: null,
    reloadNonce: 0,
  };
}

export function MiroFishPane({
  activeSurface,
  simulationId,
  reportId,
  runUrl,
  reportUrl,
  collaborationMode,
  viewerCanInteract,
  viewerCanManageSimulation,
  collaborationState,
  viewerInteractionReason,
  spotlightDisplayName,
  controllerRole,
  controllerDisplayName,
  controlLeaseExpiresAt,
  onEvent,
  onReclaimControl,
  onRecoverToLesson,
}: MiroFishPaneProps) {
  const nextSource = pickMiroFishSource(activeSurface, runUrl, reportUrl);
  const sourceIdentity = useMemo(
    () => getMiroFishSourceIdentity(activeSurface, simulationId, reportId),
    [activeSurface, reportId, simulationId],
  );
  const [paneState, setPaneState] = useState<MiroFishPaneState>(() =>
    createMiroFishPaneState(sourceIdentity, nextSource),
  );
  const [leaseNowMs, setLeaseNowMs] = useState(() => Date.now());
  const callbackRef = useRef<{
    onEvent?: (event: MiroFishHostEvent) => void;
    onRecoverToLesson?: (message: string) => void;
  }>({
    onEvent,
    onRecoverToLesson,
  });
  const loadTimeoutRef = useRef<number | null>(null);
  const recoveredAttemptRef = useRef<string | null>(null);
  const resolvedPaneState =
    paneState.sourceIdentity === sourceIdentity
      ? paneState
      : createMiroFishPaneState(sourceIdentity, nextSource);
  const { errorMessage, frameState, pinnedSrc, reloadNonce } = resolvedPaneState;
  const attemptKey = `${sourceIdentity}:${reloadNonce}`;

  const allowedOrigins = useMemo(() => {
    return [runUrl, reportUrl, pinnedSrc]
      .filter((value): value is string => Boolean(value))
      .map((value) => new URL(value).origin);
  }, [pinnedSrc, reportUrl, runUrl]);

  useEffect(() => {
    callbackRef.current = {
      onEvent,
      onRecoverToLesson,
    };
  }, [onEvent, onRecoverToLesson]);

  const resolvePaneState = useCallback(
    (current: MiroFishPaneState) =>
      current.sourceIdentity === sourceIdentity
        ? current
        : createMiroFishPaneState(sourceIdentity, nextSource),
    [nextSource, sourceIdentity],
  );

  const clearLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current !== null) {
      window.clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    setPaneState((current) => {
      const base = resolvePaneState(current);
      if (base.pinnedSrc === nextSource) {
        return base;
      }

      recoveredAttemptRef.current = null;
      return {
        ...base,
        pinnedSrc: nextSource,
        frameState: 'loading',
        errorMessage: null,
      };
    });
  }, [nextSource, resolvePaneState]);

  const markReady = useCallback(
    (event: MiroFishHostEvent) => {
      clearLoadTimeout();
      recoveredAttemptRef.current = null;
      setPaneState((current) => {
        const base = resolvePaneState(current);
        return {
          ...base,
          frameState: 'ready',
          errorMessage: null,
        };
      });
      callbackRef.current.onEvent?.(event);
    },
    [clearLoadTimeout, resolvePaneState],
  );

  const recoverAttempt = useCallback(
    (message: string, event: MiroFishHostEvent = { type: 'error', message }) => {
      if (recoveredAttemptRef.current === attemptKey) {
        return;
      }

      recoveredAttemptRef.current = attemptKey;
      clearLoadTimeout();
      setPaneState((current) => {
        const base = resolvePaneState(current);
        return {
          ...base,
          frameState: 'error',
          errorMessage: message,
        };
      });
      callbackRef.current.onEvent?.(event);
      callbackRef.current.onRecoverToLesson?.(message);
    },
    [attemptKey, clearLoadTimeout, resolvePaneState],
  );

  useEffect(() => {
    clearLoadTimeout();
    recoveredAttemptRef.current = null;

    if (!pinnedSrc) {
      return;
    }

    loadTimeoutRef.current = window.setTimeout(() => {
      recoverAttempt('MiroFish took too long to load. Returning the classroom to the lesson view.');
    }, 15_000);

    return clearLoadTimeout;
  }, [attemptKey, clearLoadTimeout, pinnedSrc, recoverAttempt]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (allowedOrigins.length > 0 && !allowedOrigins.includes(event.origin)) {
        return;
      }

      const payload =
        event.data && typeof event.data === 'object' && !Array.isArray(event.data)
          ? (event.data as Record<string, unknown>)
          : null;
      const eventType =
        typeof payload?.type === 'string'
          ? payload.type
          : typeof payload?.event === 'string'
            ? payload.event
            : null;

      if (!eventType) {
        return;
      }

      if (eventType === 'ready') {
        markReady({ type: 'ready' });
        return;
      }

      if (eventType === 'runStatus') {
        const status =
          payload?.status === 'running' ||
          payload?.status === 'completed' ||
          payload?.status === 'error'
            ? (payload.status as SharedSimulationStatus)
            : undefined;

        if (status === 'error') {
          const message =
            typeof payload?.message === 'string'
              ? payload.message
              : 'MiroFish reported a runtime error.';
          recoverAttempt(message, { type: 'runStatus', status, message });
          return;
        }

        markReady({ type: 'runStatus', status });
        return;
      }

      if (eventType === 'reportReady') {
        markReady({ type: 'reportReady' });
        return;
      }

      if (eventType === 'presenceSummary') {
        callbackRef.current.onEvent?.({
          type: 'presenceSummary',
          participantCount:
            typeof payload?.participantCount === 'number' ? payload.participantCount : undefined,
        });
        return;
      }

      if (eventType === 'sessionStatus') {
        const nextCollaborationState =
          payload?.status === 'inactive' ||
          payload?.status === 'live' ||
          payload?.status === 'frozen' ||
          payload?.status === 'closed' ||
          payload?.status === 'error'
            ? (payload.status as SharedSimulationCollaborationState)
            : undefined;

        callbackRef.current.onEvent?.({
          type: 'sessionStatus',
          collaborationState: nextCollaborationState,
          message: typeof payload?.message === 'string' ? payload.message : undefined,
        });
        return;
      }

      if (eventType === 'error') {
        const message =
          typeof payload?.message === 'string'
            ? payload.message
            : 'MiroFish reported an embed error.';
        recoverAttempt(message);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [allowedOrigins, markReady, recoverAttempt]);

  useEffect(() => {
    return clearLoadTimeout;
  }, [clearLoadTimeout]);

  useEffect(() => {
    if (!controlLeaseExpiresAt || controllerRole !== 'student') {
      return;
    }

    const interval = window.setInterval(() => {
      setLeaseNowMs(Date.now());
    }, 1_000);

    return () => window.clearInterval(interval);
  }, [controlLeaseExpiresAt, controllerRole]);

  if (!pinnedSrc) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
          <h3 className="text-lg font-semibold">MiroFish view unavailable</h3>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {activeSurface === 'report'
              ? 'This classroom does not have a report attached yet.'
              : 'The simulation URL is missing or invalid.'}
          </p>
        </div>
      </div>
    );
  }

  const isInteractiveSurface = activeSurface === 'simulation';
  const isMultiUser = collaborationMode === 'multi-user';
  const showReadOnlyBlocker = isInteractiveSurface && !viewerCanInteract;
  const canReclaim = !isMultiUser && viewerCanManageSimulation && controllerRole === 'student';
  const leaseCountdown = formatLeaseCountdown(controlLeaseExpiresAt, leaseNowMs);
  const overlayTitle = isMultiUser ? 'Read-only collaboration view' : 'Read-only classroom view';
  const overlayMessage = (() => {
    if (!isMultiUser) {
      return controllerRole === 'student'
        ? `${controllerDisplayName} currently has control of the shared simulation.`
        : `${controllerDisplayName} is controlling the shared simulation.`;
    }

    switch (viewerInteractionReason) {
      case 'removed':
        return 'The teacher removed this session from live interaction. You can keep watching the shared simulation.';
      case 'frozen':
        return 'The teacher has temporarily frozen student interaction. You can keep watching while collaboration is paused.';
      case 'closed':
        return 'The shared simulation is closed right now. The classroom can still watch until the teacher reopens collaboration.';
      case 'inactive':
      default:
        return 'The shared simulation is not live yet. You can keep watching until the teacher opens collaboration.';
    }
  })();

  return (
    <div className="absolute inset-0 overflow-hidden bg-slate-950">
      <iframe
        key={attemptKey}
        src={pinnedSrc}
        title="MiroFish Classroom Pane"
        className="absolute inset-0 h-full w-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        allow="fullscreen"
        onLoad={() => {
          if (frameState !== 'error') {
            markReady({ type: 'ready' });
          }
        }}
      />

      {frameState === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/85 backdrop-blur-sm dark:bg-slate-950/85">
          <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading MiroFish...
          </div>
        </div>
      )}

      {isInteractiveSurface && isMultiUser && spotlightDisplayName && (
        <div className="absolute left-4 top-4 z-10 rounded-full border border-white/60 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-950/85 dark:text-slate-200">
          Spotlight: {spotlightDisplayName}
        </div>
      )}

      {showReadOnlyBlocker && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/18 backdrop-blur-[1px]">
          <div className="max-w-sm rounded-2xl border border-white/60 bg-white/92 p-5 text-center shadow-xl dark:border-slate-800 dark:bg-slate-950/92">
            <Shield className="mx-auto mb-3 h-8 w-8 text-slate-600 dark:text-slate-300" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {overlayTitle}
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{overlayMessage}</p>
            {!isMultiUser && controllerRole === 'student' && leaseCountdown && (
              <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                Lease: {leaseCountdown}
              </p>
            )}
            {isMultiUser && collaborationState && (
              <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                State: {collaborationState}
              </p>
            )}
            {canReclaim && (
              <Button
                type="button"
                className="mt-4 inline-flex items-center gap-2"
                onClick={onReclaimControl}
              >
                <Undo2 className="h-4 w-4" />
                Reclaim control
              </Button>
            )}
          </div>
        </div>
      )}

      {frameState === 'error' && errorMessage && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/94 dark:bg-slate-950/94">
          <div className="max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-lg dark:border-rose-900 dark:bg-slate-950">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-rose-500" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              MiroFish could not stay connected
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{errorMessage}</p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button type="button" onClick={() => onRecoverToLesson?.(errorMessage)}>
                Return to lesson
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  clearLoadTimeout();
                  recoveredAttemptRef.current = null;
                  setPaneState((current) => {
                    const base = resolvePaneState(current);
                    return {
                      ...base,
                      pinnedSrc: nextSource,
                      frameState: 'loading',
                      errorMessage: null,
                      reloadNonce: base.reloadNonce + 1,
                    };
                  });
                }}
              >
                Retry MiroFish
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

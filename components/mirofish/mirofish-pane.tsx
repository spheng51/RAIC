'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Shield, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PresentationSurface, SharedSimulationStatus } from '@/lib/types/stage';

export interface MiroFishHostEvent {
  type: 'ready' | 'runStatus' | 'reportReady' | 'error';
  status?: SharedSimulationStatus;
  message?: string;
}

interface MiroFishPaneProps {
  readonly activeSurface: Extract<PresentationSurface, 'simulation' | 'report'>;
  readonly runUrl: string | null;
  readonly reportUrl: string | null;
  readonly viewerHasSimulationControl: boolean;
  readonly viewerCanManageSimulation: boolean;
  readonly controllerRole: 'teacher' | 'student';
  readonly onEvent?: (event: MiroFishHostEvent) => void;
  readonly onReclaimControl?: () => void;
  readonly onRecoverToLesson?: (message: string) => void;
}

function pickMiroFishSource(
  activeSurface: Extract<PresentationSurface, 'simulation' | 'report'>,
  runUrl: string | null,
  reportUrl: string | null,
) {
  return activeSurface === 'report' ? reportUrl : runUrl;
}

export function MiroFishPane({
  activeSurface,
  runUrl,
  reportUrl,
  viewerHasSimulationControl,
  viewerCanManageSimulation,
  controllerRole,
  onEvent,
  onReclaimControl,
  onRecoverToLesson,
}: MiroFishPaneProps) {
  const src = pickMiroFishSource(activeSurface, runUrl, reportUrl);
  const [frameState, setFrameState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const errorReportedRef = useRef(false);

  const allowedOrigins = useMemo(() => {
    return [runUrl, reportUrl]
      .filter((value): value is string => Boolean(value))
      .map((value) => new URL(value).origin);
  }, [reportUrl, runUrl]);

  useEffect(() => {
    setFrameState('loading');
    setErrorMessage(null);
    errorReportedRef.current = false;
  }, [src]);

  useEffect(() => {
    if (!src) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (errorReportedRef.current) {
        return;
      }

      errorReportedRef.current = true;
      const message = 'MiroFish took too long to load. Returning the classroom to the lesson view.';
      setFrameState('error');
      setErrorMessage(message);
      onEvent?.({ type: 'error', message });
      onRecoverToLesson?.(message);
    }, 15_000);

    return () => window.clearTimeout(timeout);
  }, [onEvent, onRecoverToLesson, src]);

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
        setFrameState('ready');
        setErrorMessage(null);
        onEvent?.({ type: 'ready' });
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
          setFrameState('error');
          setErrorMessage(message);
          onEvent?.({ type: 'runStatus', status, message });
          onRecoverToLesson?.(message);
          return;
        }

        setFrameState('ready');
        onEvent?.({ type: 'runStatus', status });
        return;
      }

      if (eventType === 'reportReady') {
        setFrameState('ready');
        onEvent?.({ type: 'reportReady' });
        return;
      }

      if (eventType === 'error') {
        const message =
          typeof payload?.message === 'string'
            ? payload.message
            : 'MiroFish reported an embed error.';
        setFrameState('error');
        setErrorMessage(message);
        onEvent?.({ type: 'error', message });
        onRecoverToLesson?.(message);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [allowedOrigins, onEvent, onRecoverToLesson]);

  if (!src) {
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

  const showReadOnlyBlocker = !viewerHasSimulationControl;
  const canReclaim = viewerCanManageSimulation && controllerRole === 'student';

  return (
    <div className="absolute inset-0 overflow-hidden bg-slate-950">
      <iframe
        key={src}
        src={src}
        title="MiroFish Classroom Pane"
        className="absolute inset-0 h-full w-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        allow="fullscreen"
        onLoad={() => {
          if (frameState !== 'error') {
            setFrameState('ready');
            onEvent?.({ type: 'ready' });
          }
        }}
      />

      {frameState === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/85 backdrop-blur-sm dark:bg-slate-950/85">
          <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading MiroFish…
          </div>
        </div>
      )}

      {showReadOnlyBlocker && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/18 backdrop-blur-[1px]">
          <div className="max-w-sm rounded-2xl border border-white/60 bg-white/92 p-5 text-center shadow-xl dark:border-slate-800 dark:bg-slate-950/92">
            <Shield className="mx-auto mb-3 h-8 w-8 text-slate-600 dark:text-slate-300" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Read-only classroom view
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {controllerRole === 'student'
                ? 'A student currently has control of the shared simulation.'
                : 'The teacher is controlling the shared simulation.'}
            </p>
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
                  setFrameState('loading');
                  setErrorMessage(null);
                  errorReportedRef.current = false;
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

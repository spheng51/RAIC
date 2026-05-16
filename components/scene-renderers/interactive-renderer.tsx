'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { InteractiveContent } from '@/lib/types/stage';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';
import { patchHtmlForIframe } from '@/lib/utils/iframe';
import type {
  ClassroomGameSessionPayload,
  ClassroomGameStudentEventType,
} from '@/lib/types/classroom-game-session';

const GAME_PROGRESS_DEBOUNCE_MS = 500;
const LIVE_GAME_EVENTS = new Set<ClassroomGameStudentEventType>([
  'progress',
  'score',
  'complete',
  'shared_state',
  'control_input',
]);

interface InteractiveRendererProps {
  readonly content: InteractiveContent;
  readonly mode: 'autonomous' | 'playback';
  readonly sceneId: string;
  readonly gameSession?: ClassroomGameSessionPayload | null;
  readonly onGameEvent?: (event: {
    event: ClassroomGameStudentEventType;
    roundId?: string | null;
    score?: number;
    progress?: number;
    state?: Record<string, unknown>;
    input?: Record<string, unknown>;
  }) => void;
}

export function InteractiveRenderer({
  content,
  mode: _mode,
  sceneId,
  gameSession,
  onGameEvent,
}: InteractiveRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const gameSessionRef = useRef<ClassroomGameSessionPayload | null>(gameSession ?? null);
  const previousGameSessionRef = useRef<{
    roundId: string | null;
    status: ClassroomGameSessionPayload['status'];
  } | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProgressEventRef = useRef<Parameters<NonNullable<typeof onGameEvent>>[0] | null>(
    null,
  );
  const registerIframe = useWidgetIframeStore((state) => state.registerIframe);
  const setActiveScene = useWidgetIframeStore((state) => state.setActiveScene);
  const patchedHtml = useMemo(
    () => (content.html ? patchHtmlForIframe(content.html) : undefined),
    [content.html],
  );
  const submissionGateKey = useMemo(() => {
    if (!gameSession) return 'no-session';
    return [
      gameSession.roundId ?? 'no-round',
      gameSession.status,
      gameSession.mode,
      gameSession.viewerCanManage ? 'manager' : 'player',
      gameSession.viewerCanSubmit ? 'can-submit' : 'cannot-submit',
      gameSession.viewerIsController ? 'controller' : 'not-controller',
    ].join(':');
  }, [
    gameSession?.mode,
    gameSession?.roundId,
    gameSession?.status,
    gameSession?.viewerCanManage,
    gameSession?.viewerCanSubmit,
    gameSession?.viewerIsController,
  ]);
  const sendMessageToIframe = useCallback((type: string, payload: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ type, ...payload }, '*');
  }, []);

  const sendGameControlToIframe = useCallback(
    (action: string, payload: Record<string, unknown> = {}) => {
      if (content.widgetType !== 'game') return;
      sendMessageToIframe('RAIC_GAME_CONTROL', { payload: { action, ...payload } });
    },
    [content.widgetType, sendMessageToIframe],
  );

  const sendGameSessionToIframe = useCallback(() => {
    if (!gameSession || content.widgetType !== 'game') return;
    sendMessageToIframe('RAIC_GAME_STATE', { gameSession });
  }, [content.widgetType, gameSession, sendMessageToIframe]);

  const clearPendingProgressEvent = useCallback(() => {
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    pendingProgressEventRef.current = null;
  }, []);

  const canForwardGameEvent = useCallback((event: ClassroomGameStudentEventType) => {
    const session = gameSessionRef.current;
    if (!session || session.viewerCanManage || !session.viewerCanSubmit) {
      return false;
    }

    if (LIVE_GAME_EVENTS.has(event)) {
      if (session.status !== 'live' || !session.roundId) {
        return false;
      }

      if (event === 'shared_state' || event === 'control_input') {
        return session.mode !== 'leaderboard' && session.viewerIsController;
      }
    }

    return true;
  }, []);

  useEffect(() => {
    registerIframe(sceneId, sendMessageToIframe);
    setActiveScene(sceneId);
    return () => {
      registerIframe(sceneId, null);
      if (useWidgetIframeStore.getState().activeSceneId === sceneId) {
        setActiveScene(null);
      }
    };
  }, [registerIframe, sceneId, sendMessageToIframe, setActiveScene]);

  useEffect(() => {
    gameSessionRef.current = gameSession ?? null;
  }, [gameSession]);

  useEffect(() => {
    clearPendingProgressEvent();
  }, [clearPendingProgressEvent, submissionGateKey]);

  useEffect(() => {
    sendGameSessionToIframe();
    if (!gameSession || content.widgetType !== 'game') {
      previousGameSessionRef.current = null;
      return;
    }

    const previous = previousGameSessionRef.current;
    if (!previous) {
      sendGameControlToIframe('request_bridge_ready');
    } else if (
      previous &&
      gameSession.status === 'idle' &&
      (previous.status !== 'idle' || previous.roundId !== gameSession.roundId)
    ) {
      sendGameControlToIframe('reset');
      sendGameControlToIframe('request_bridge_ready');
    }
    previousGameSessionRef.current = {
      roundId: gameSession.roundId,
      status: gameSession.status,
    };
  }, [content.widgetType, gameSession, sendGameControlToIframe, sendGameSessionToIframe]);

  useEffect(
    () => () => {
      clearPendingProgressEvent();
    },
    [clearPendingProgressEvent],
  );

  useEffect(() => {
    if (content.widgetType !== 'game' || !onGameEvent) {
      return;
    }

    const flushProgressEvent = () => {
      const pending = pendingProgressEventRef.current;
      pendingProgressEventRef.current = null;
      progressTimerRef.current = null;
      if (pending && canForwardGameEvent(pending.event)) {
        onGameEvent(pending);
      }
    };

    const forwardGameEvent = (payload: {
      event: ClassroomGameStudentEventType;
      score?: number;
      progress?: number;
      state?: Record<string, unknown>;
      input?: Record<string, unknown>;
    }) => {
      if (!canForwardGameEvent(payload.event)) {
        return;
      }

      const nextPayload = {
        ...payload,
        roundId: gameSession?.roundId ?? null,
      };

      if (payload.event === 'progress') {
        pendingProgressEventRef.current = nextPayload;
        if (!progressTimerRef.current) {
          progressTimerRef.current = setTimeout(flushProgressEvent, GAME_PROGRESS_DEBOUNCE_MS);
        }
        return;
      }

      if (payload.event === 'score' || payload.event === 'complete') {
        clearPendingProgressEvent();
      }

      onGameEvent(nextPayload);
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      const message = event.data as {
        type?: string;
        event?: ClassroomGameStudentEventType;
        score?: number;
        progress?: number;
        state?: Record<string, unknown>;
        input?: Record<string, unknown>;
      } | null;
      if (!message || message.type !== 'RAIC_GAME_EVENT' || !message.event) {
        return;
      }

      forwardGameEvent({
        event: message.event,
        ...(typeof message.score === 'number' ? { score: message.score } : {}),
        ...(typeof message.progress === 'number' ? { progress: message.progress } : {}),
        ...(message.state ? { state: message.state } : {}),
        ...(message.input ? { input: message.input } : {}),
      });
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [
    canForwardGameEvent,
    clearPendingProgressEvent,
    content.widgetType,
    gameSession?.roundId,
    onGameEvent,
  ]);

  return (
    <div className="w-full h-full relative">
      <iframe
        ref={iframeRef}
        srcDoc={patchedHtml}
        src={patchedHtml ? undefined : content.url}
        className="absolute inset-0 w-full h-full border-0"
        title={`Interactive Scene ${sceneId}`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        onLoad={() => {
          sendGameSessionToIframe();
          sendGameControlToIframe('request_bridge_ready');
        }}
      />
    </div>
  );
}

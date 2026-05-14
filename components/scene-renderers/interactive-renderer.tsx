'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { InteractiveContent } from '@/lib/types/stage';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';
import { patchHtmlForIframe } from '@/lib/utils/iframe';
import type {
  ClassroomGameSessionPayload,
  ClassroomGameStudentEventType,
} from '@/lib/types/classroom-game-session';

interface InteractiveRendererProps {
  readonly content: InteractiveContent;
  readonly mode: 'autonomous' | 'playback';
  readonly sceneId: string;
  readonly gameSession?: ClassroomGameSessionPayload | null;
  readonly onGameEvent?: (event: {
    event: ClassroomGameStudentEventType;
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
  const previousGameSessionRef = useRef<ClassroomGameSessionPayload | null>(null);
  const registerIframe = useWidgetIframeStore((state) => state.registerIframe);
  const setActiveScene = useWidgetIframeStore((state) => state.setActiveScene);
  const patchedHtml = useMemo(
    () => (content.html ? patchHtmlForIframe(content.html) : undefined),
    [content.html],
  );
  const sendMessageToIframe = useCallback((type: string, payload: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ type, ...payload }, '*');
  }, []);

  const sendGameSessionToIframe = useCallback(() => {
    if (!gameSession || content.widgetType !== 'game') return;
    sendMessageToIframe('RAIC_GAME_STATE', { gameSession });
  }, [content.widgetType, gameSession, sendMessageToIframe]);

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
    sendGameSessionToIframe();
    if (!gameSession || content.widgetType !== 'game') {
      previousGameSessionRef.current = gameSession ?? null;
      return;
    }

    const previous = previousGameSessionRef.current;
    if (previous?.roundId && !gameSession.roundId && gameSession.status === 'idle') {
      sendMessageToIframe('RAIC_GAME_CONTROL', { payload: { action: 'reset' } });
    }
    if (previous && previous.controllerSessionId !== gameSession.controllerSessionId) {
      sendMessageToIframe('RAIC_GAME_CONTROL', {
        payload: {
          action: gameSession.controllerSessionId ? 'assign_controller' : 'clear_controller',
          controllerSessionId: gameSession.controllerSessionId,
        },
      });
    }
    previousGameSessionRef.current = gameSession;
  }, [content.widgetType, gameSession, sendGameSessionToIframe, sendMessageToIframe]);

  useEffect(() => {
    if (content.widgetType !== 'game' || !onGameEvent) {
      return;
    }

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

      onGameEvent({
        event: message.event,
        ...(typeof message.score === 'number' ? { score: message.score } : {}),
        ...(typeof message.progress === 'number' ? { progress: message.progress } : {}),
        ...(message.state ? { state: message.state } : {}),
        ...(message.input ? { input: message.input } : {}),
      });
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [content.widgetType, onGameEvent]);

  return (
    <div className="w-full h-full relative">
      <iframe
        ref={iframeRef}
        srcDoc={patchedHtml}
        src={patchedHtml ? undefined : content.url}
        className="absolute inset-0 w-full h-full border-0"
        title={`Interactive Scene ${sceneId}`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        onLoad={sendGameSessionToIframe}
      />
    </div>
  );
}

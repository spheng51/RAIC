'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { InteractiveContent } from '@/lib/types/stage';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';
import { patchHtmlForIframe } from '@/lib/utils/iframe';

interface InteractiveRendererProps {
  readonly content: InteractiveContent;
  readonly mode: 'autonomous' | 'playback';
  readonly sceneId: string;
}

export function InteractiveRenderer({ content, mode: _mode, sceneId }: InteractiveRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const registerIframe = useWidgetIframeStore((state) => state.registerIframe);
  const setActiveScene = useWidgetIframeStore((state) => state.setActiveScene);
  const patchedHtml = useMemo(
    () => (content.html ? patchHtmlForIframe(content.html) : undefined),
    [content.html],
  );
  const sendMessageToIframe = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage({ type, ...payload }, '*');
    },
    [],
  );

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

  return (
    <div className="w-full h-full relative">
      <iframe
        ref={iframeRef}
        srcDoc={patchedHtml}
        src={patchedHtml ? undefined : content.url}
        className="absolute inset-0 w-full h-full border-0"
        title={`Interactive Scene ${sceneId}`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}

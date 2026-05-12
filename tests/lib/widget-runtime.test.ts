import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionEngine } from '@/lib/action/engine';
import { PlaybackEngine } from '@/lib/playback/engine';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';
import type { StageStore } from '@/lib/api/stage-api';
import type { Scene } from '@/lib/types/stage';
import type { AudioPlayer } from '@/lib/utils/audio-player';

function createStageStore(): StageStore {
  return {
    getState: () => ({
      stage: null,
      scenes: [],
      currentSceneId: null,
      mode: 'playback',
    }),
    setState: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  } as unknown as StageStore;
}

function createAudioPlayer(): AudioPlayer {
  return {
    play: vi.fn(async () => false),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    isPlaying: vi.fn(() => false),
    hasActiveAudio: vi.fn(() => false),
    onEnded: vi.fn(),
  } as unknown as AudioPlayer;
}

function createWidgetScene(): Scene {
  return {
    id: 'scene-widget',
    stageId: 'stage-1',
    type: 'interactive',
    title: 'Widget',
    order: 1,
    content: {
      type: 'interactive',
      url: '',
      html: '<!DOCTYPE html><html><body>Widget</body></html>',
      widgetType: 'simulation',
    },
    actions: [
      {
        id: 'highlight-1',
        type: 'widget_highlight',
        target: '#angle-slider',
      },
      {
        id: 'state-1',
        type: 'widget_setState',
        state: { angle: 60 },
      },
    ],
  };
}

describe('widget iframe store', () => {
  beforeEach(() => {
    useWidgetIframeStore.setState({ sendMessageByScene: {}, activeSceneId: null });
  });

  it('registers, targets, and unregisters iframe message callbacks', () => {
    const sendSceneA = vi.fn();
    const sendSceneB = vi.fn();

    useWidgetIframeStore.getState().registerIframe('scene-a', sendSceneA);
    useWidgetIframeStore.getState().registerIframe('scene-b', sendSceneB);
    useWidgetIframeStore.getState().setActiveScene('scene-b');

    useWidgetIframeStore.getState().getSendMessage('scene-a')?.('HIGHLIGHT_ELEMENT', {
      target: '#a',
    });
    useWidgetIframeStore.getState().getSendMessage()?.('REVEAL_ELEMENT', { target: '#b' });

    expect(sendSceneA).toHaveBeenCalledWith('HIGHLIGHT_ELEMENT', { target: '#a' });
    expect(sendSceneB).toHaveBeenCalledWith('REVEAL_ELEMENT', { target: '#b' });

    useWidgetIframeStore.getState().registerIframe('scene-a', null);
    expect(useWidgetIframeStore.getState().getSendMessage('scene-a')).toBeNull();
  });
});

describe('widget action runtime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches widget actions through ActionEngine postMessage callbacks', async () => {
    vi.useFakeTimers();
    const sendWidgetMessage = vi.fn();
    const engine = new ActionEngine(createStageStore(), undefined, sendWidgetMessage);

    const run = engine.execute({
      id: 'highlight-1',
      type: 'widget_highlight',
      target: '#angle-slider',
    });
    await vi.advanceTimersByTimeAsync(300);
    await run;

    expect(sendWidgetMessage).toHaveBeenCalledWith('HIGHLIGHT_ELEMENT', {
      target: '#angle-slider',
    });
  });

  it('awaits widget actions and continues playback', async () => {
    const execute = vi.fn(async (_action: { type: string }) => {});
    const clearEffects = vi.fn();
    const onComplete = vi.fn();
    const playback = new PlaybackEngine(
      [createWidgetScene()],
      { execute, clearEffects } as unknown as ActionEngine,
      createAudioPlayer(),
      {
        onComplete,
      },
    );

    playback.start();

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([action]) => action.type)).toEqual([
      'widget_highlight',
      'widget_setState',
    ]);
  });
});

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractiveRenderer } from '@/components/scene-renderers/interactive-renderer';
import type { ClassroomGameSessionPayload } from '@/lib/types/classroom-game-session';
import type { InteractiveContent } from '@/lib/types/stage';

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

const gameContent: InteractiveContent = {
  type: 'interactive',
  widgetType: 'game',
  url: '',
  html: '<!doctype html><html><body><button>Start</button></body></html>',
};

function buildGameSession(
  overrides: Partial<ClassroomGameSessionPayload> = {},
): ClassroomGameSessionPayload {
  return {
    classroomId: 'room-1',
    roundId: 'round-1',
    roundNumber: 1,
    mode: 'both',
    status: 'live',
    controllerSessionId: null,
    latestSharedState: null,
    players: {},
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
    participantCount: 0,
    participants: [],
    leaderboard: [],
    viewerSessionId: 'student-session',
    viewerRole: 'student',
    viewerKind: 'classroom',
    viewerCanManage: false,
    viewerCanSubmit: true,
    viewerIsController: false,
    multiplayerSupported: true,
    ...overrides,
  };
}

async function renderRenderer(
  gameSession: ClassroomGameSessionPayload | null,
  onGameEvent = vi.fn(),
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(
      <InteractiveRenderer
        content={gameContent}
        mode="playback"
        sceneId="scene-1"
        gameSession={gameSession}
        onGameEvent={onGameEvent}
      />,
    );
  });

  return {
    container,
    iframe: container.querySelector('iframe')!,
    onGameEvent,
    rerender: async (nextSession: ClassroomGameSessionPayload | null) => {
      await act(async () => {
        root.render(
          <InteractiveRenderer
            content={gameContent}
            mode="playback"
            sceneId="scene-1"
            gameSession={nextSession}
            onGameEvent={onGameEvent}
          />,
        );
      });
    },
  };
}

function postFromIframe(iframe: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data,
      source: iframe.contentWindow,
    }),
  );
}

describe('InteractiveRenderer game bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    vi.useRealTimers();
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) continue;
      await act(async () => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
  });

  it('forwards the current round id and debounces progress events', async () => {
    const { iframe, onGameEvent } = await renderRenderer(buildGameSession());

    await act(async () => {
      postFromIframe(iframe, { type: 'RAIC_GAME_EVENT', event: 'progress', progress: 10 });
      postFromIframe(iframe, { type: 'RAIC_GAME_EVENT', event: 'progress', progress: 30 });
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(onGameEvent).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onGameEvent).toHaveBeenCalledTimes(1);
    expect(onGameEvent).toHaveBeenCalledWith({
      event: 'progress',
      progress: 30,
      roundId: 'round-1',
    });
  });

  it('drops pending progress when a newer score or complete event arrives', async () => {
    const { iframe, onGameEvent } = await renderRenderer(buildGameSession());

    await act(async () => {
      postFromIframe(iframe, { type: 'RAIC_GAME_EVENT', event: 'progress', progress: 40 });
      await vi.advanceTimersByTimeAsync(250);
      postFromIframe(iframe, {
        type: 'RAIC_GAME_EVENT',
        event: 'complete',
        score: 90,
        progress: 100,
      });
    });

    expect(onGameEvent).toHaveBeenCalledTimes(1);
    expect(onGameEvent).toHaveBeenCalledWith({
      event: 'complete',
      score: 90,
      progress: 100,
      roundId: 'round-1',
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(onGameEvent).toHaveBeenCalledTimes(1);
  });

  it('does not forward teacher iframe game events as player submissions', async () => {
    const { iframe, onGameEvent } = await renderRenderer(
      buildGameSession({
        viewerKind: 'web',
        viewerRole: 'teacher',
        viewerCanManage: true,
        viewerCanSubmit: false,
      }),
    );

    await act(async () => {
      postFromIframe(iframe, { type: 'RAIC_GAME_EVENT', event: 'bridge_ready' });
    });

    expect(onGameEvent).not.toHaveBeenCalled();
  });

  it('does not forward player game events when submission is not allowed', async () => {
    const { iframe, onGameEvent, rerender } = await renderRenderer(
      buildGameSession({ viewerCanSubmit: false }),
    );

    await act(async () => {
      postFromIframe(iframe, { type: 'RAIC_GAME_EVENT', event: 'score', score: 10, progress: 20 });
    });
    expect(onGameEvent).not.toHaveBeenCalled();

    await rerender(buildGameSession({ status: 'paused' }));
    await act(async () => {
      postFromIframe(iframe, { type: 'RAIC_GAME_EVENT', event: 'score', score: 20, progress: 40 });
    });
    expect(onGameEvent).not.toHaveBeenCalled();

    await rerender(buildGameSession({ status: 'completed' }));
    await act(async () => {
      postFromIframe(iframe, {
        type: 'RAIC_GAME_EVENT',
        event: 'complete',
        score: 30,
        progress: 100,
      });
    });
    expect(onGameEvent).not.toHaveBeenCalled();
  });

  it('forwards shared-control input only from the current controller', async () => {
    const { iframe, onGameEvent, rerender } = await renderRenderer(
      buildGameSession({
        mode: 'shared-control',
        viewerIsController: false,
      }),
    );

    await act(async () => {
      postFromIframe(iframe, {
        type: 'RAIC_GAME_EVENT',
        event: 'control_input',
        input: { dx: 1 },
      });
    });
    expect(onGameEvent).not.toHaveBeenCalled();

    await rerender(
      buildGameSession({
        mode: 'shared-control',
        viewerIsController: true,
      }),
    );
    await act(async () => {
      postFromIframe(iframe, {
        type: 'RAIC_GAME_EVENT',
        event: 'control_input',
        input: { dx: 1 },
      });
    });

    expect(onGameEvent).toHaveBeenCalledWith({
      event: 'control_input',
      input: { dx: 1 },
      roundId: 'round-1',
    });
  });

  it('does not forward shared-control input outside a live round', async () => {
    const { iframe, onGameEvent, rerender } = await renderRenderer(
      buildGameSession({
        mode: 'shared-control',
        status: 'paused',
        viewerIsController: true,
      }),
    );

    await act(async () => {
      postFromIframe(iframe, {
        type: 'RAIC_GAME_EVENT',
        event: 'control_input',
        input: { dx: 1 },
      });
    });
    expect(onGameEvent).not.toHaveBeenCalled();

    await rerender(
      buildGameSession({
        mode: 'shared-control',
        status: 'completed',
        viewerIsController: true,
      }),
    );
    await act(async () => {
      postFromIframe(iframe, {
        type: 'RAIC_GAME_EVENT',
        event: 'control_input',
        input: { dx: 2 },
      });
    });
    expect(onGameEvent).not.toHaveBeenCalled();

    await rerender(
      buildGameSession({
        mode: 'shared-control',
        roundId: null,
        viewerIsController: true,
      }),
    );
    await act(async () => {
      postFromIframe(iframe, {
        type: 'RAIC_GAME_EVENT',
        event: 'control_input',
        input: { dx: 3 },
      });
    });

    expect(onGameEvent).not.toHaveBeenCalled();
  });

  it('drops debounced progress when the round resets before the debounce flushes', async () => {
    const { iframe, onGameEvent, rerender } = await renderRenderer(buildGameSession());

    await act(async () => {
      postFromIframe(iframe, { type: 'RAIC_GAME_EVENT', event: 'progress', progress: 30 });
      await vi.advanceTimersByTimeAsync(250);
    });

    await rerender(
      buildGameSession({
        roundId: null,
        roundNumber: 0,
        status: 'idle',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(onGameEvent).not.toHaveBeenCalled();
  });

  it('requests bridge readiness on load and sends reset control when the session resets', async () => {
    const { iframe, rerender } = await renderRenderer(buildGameSession());
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, 'postMessage');

    await act(async () => {
      iframe.dispatchEvent(new Event('load'));
    });
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RAIC_GAME_CONTROL' }),
      '*',
    );

    await rerender(
      buildGameSession({
        roundId: null,
        roundNumber: 0,
        status: 'idle',
      }),
    );

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: 'RAIC_GAME_CONTROL',
        payload: { action: 'reset' },
      },
      '*',
    );
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: 'RAIC_GAME_CONTROL',
        payload: { action: 'request_bridge_ready' },
      },
      '*',
    );
  });

  it('requests bridge readiness when a game session arrives after iframe load', async () => {
    const { iframe, rerender } = await renderRenderer(null);
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, 'postMessage');

    await act(async () => {
      iframe.dispatchEvent(new Event('load'));
    });
    postMessageSpy.mockClear();

    await rerender(buildGameSession());

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: 'RAIC_GAME_CONTROL',
        payload: { action: 'request_bridge_ready' },
      },
      '*',
    );
  });
});

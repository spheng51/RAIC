// @vitest-environment jsdom

import { act, createElement, createRef, forwardRef, useImperativeHandle } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassroomGameSessionPayload } from '@/lib/types/classroom-game-session';

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readonly close = vi.fn();
  onerror: ((event: Event) => void) | null = null;
  private readonly listeners = new Map<
    string,
    Set<(event: Event | MessageEvent<string>) => void>
  >();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  static reset() {
    MockEventSource.instances = [];
  }

  addEventListener(type: string, listener: (event: Event | MessageEvent<string>) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: Event | MessageEvent<string>) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, data?: unknown) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;

    const event =
      type === 'game-session-state'
        ? ({ data: JSON.stringify(data) } as MessageEvent<string>)
        : (new Event(type) as Event);
    listeners.forEach((listener) => listener(event));
  }
}

interface MountedHook {
  readonly refresh: (silent?: boolean) => Promise<void>;
}

interface MountedHookHandle {
  refresh: (silent?: boolean) => Promise<void>;
}

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
const fetchMock = vi.fn();

function buildGameSessionState(
  overrides: Partial<ClassroomGameSessionPayload> = {},
): ClassroomGameSessionPayload {
  return {
    classroomId: 'room-1',
    roundId: null,
    roundNumber: 0,
    mode: 'both',
    status: 'idle',
    controllerSessionId: null,
    latestSharedState: null,
    players: {},
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
    roomVersion: 1,
    participantCount: 0,
    participants: [],
    leaderboard: [],
    viewerSessionId: 'session-1',
    viewerRole: 'teacher',
    viewerKind: 'web',
    viewerCanManage: true,
    viewerCanSubmit: true,
    viewerIsController: false,
    multiplayerSupported: false,
    ...overrides,
  };
}

async function mountHook(
  onStateChange: (state: ClassroomGameSessionPayload | null) => void,
  initialClassroomId = 'room-1',
  initialEnabled = true,
): Promise<MountedHook> {
  const { useClassroomGameSessionState } = await import(
    '@/lib/hooks/use-classroom-game-session-state'
  );

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  const hookHandleRef = createRef<MountedHookHandle>();

  const Harness = forwardRef<MountedHookHandle>(function Harness(_props, ref) {
    const hook = useClassroomGameSessionState({
      classroomId: initialClassroomId,
      enabled: initialEnabled,
      onStateChange,
    });

    useImperativeHandle(
      ref,
      () => ({
        refresh: hook.refreshGameSessionState,
      }),
      [hook.refreshGameSessionState],
    );

    return createElement('div');
  });

  await act(async () => {
    root.render(createElement(Harness, { ref: hookHandleRef }));
  });

  return {
    refresh: async (silent = false) => {
      await act(async () => {
        await hookHandleRef.current?.refresh(silent);
      });
    },
  };
}

describe('useClassroomGameSessionState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    MockEventSource.reset();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', MockEventSource);
    (window as typeof window & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;
    (
      window as typeof window & {
        EventSource?: typeof EventSource;
      }
    ).EventSource = MockEventSource as unknown as typeof EventSource;
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();

    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) continue;

      await act(async () => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
  });

  it('prefers game-session SSE updates while the stream is healthy', async () => {
    const bootstrapState = buildGameSessionState({ viewerSessionId: 'bootstrap-session' });
    const streamState = buildGameSessionState({
      roundId: 'round-1',
      roundNumber: 1,
      status: 'live',
      viewerSessionId: 'stream-session',
    });
    const onStateChange = vi.fn();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        ...bootstrapState,
      }),
    });

    await mountHook(onStateChange);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(1);

    const source = MockEventSource.instances[0];
    await act(async () => {
      source.emit('open');
      source.emit('game-session-state', streamState);
    });

    expect(onStateChange).toHaveBeenNthCalledWith(1, expect.objectContaining(bootstrapState));
    expect(onStateChange).toHaveBeenNthCalledWith(2, streamState);

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling on disconnect and reconnects cleanly', async () => {
    const bootstrapState = buildGameSessionState();
    const reconnectedState = buildGameSessionState({
      status: 'paused',
      viewerSessionId: 'reconnected-session',
    });
    const onStateChange = vi.fn();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        ...bootstrapState,
      }),
    });

    await mountHook(onStateChange);

    const firstSource = MockEventSource.instances[0];
    await act(async () => {
      firstSource.onerror?.(new Event('error'));
    });

    expect(firstSource.close).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    const secondSource = MockEventSource.instances[1];
    await act(async () => {
      secondSource.emit('open');
      secondSource.emit('game-session-state', reconnectedState);
      vi.advanceTimersByTime(5_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onStateChange).toHaveBeenCalledWith(reconnectedState);
  });

  it('does not fetch while disabled', async () => {
    const onStateChange = vi.fn();
    await mountHook(onStateChange, 'room-1', false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(0);
  });
});

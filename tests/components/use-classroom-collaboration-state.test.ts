// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassroomCollaborationStatePayload } from '@/lib/types/classroom-collaboration';

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
    if (!listeners) {
      return;
    }

    const event =
      type === 'collaboration-state'
        ? ({ data: JSON.stringify(data) } as MessageEvent<string>)
        : (new Event(type) as Event);
    listeners.forEach((listener) => listener(event));
  }
}

interface MountedHook {
  readonly rerender: (classroomId?: string, enabled?: boolean) => Promise<void>;
  readonly refresh: (silent?: boolean) => Promise<void>;
}

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
const fetchMock = vi.fn();

function buildCollaborationState(
  overrides: Partial<ClassroomCollaborationStatePayload> = {},
): ClassroomCollaborationStatePayload {
  return {
    collaborationMode: 'multi-user',
    collaborationState: 'live',
    allowStudentInteraction: true,
    spotlightSessionId: null,
    participantCount: 0,
    participants: [],
    mirofishSessionId: 'miro-session-1',
    lastCollaborationSyncAt: '2026-04-11T00:00:00.000Z',
    viewerSessionId: 'session-1',
    viewerRole: 'teacher',
    viewerKind: 'web',
    viewerCanModerateCollaboration: true,
    viewerCanInteract: true,
    viewerIsRemoved: false,
    viewerInteractionReason: null,
    multiUserEnabled: true,
    ...overrides,
  };
}

async function mountHook(
  onStateChange: (state: ClassroomCollaborationStatePayload | null) => void,
  initialClassroomId = 'room-1',
  initialEnabled = true,
): Promise<MountedHook> {
  const { useClassroomCollaborationState } =
    await import('@/lib/hooks/use-classroom-collaboration-state');

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  let classroomId = initialClassroomId;
  let enabled = initialEnabled;
  const hookState: {
    current?: ReturnType<typeof useClassroomCollaborationState>['refreshCollaborationState'];
  } = {};

  function Harness({
    nextClassroomId,
    nextEnabled,
  }: {
    nextClassroomId?: string;
    nextEnabled?: boolean;
  }) {
    const hook = useClassroomCollaborationState({
      classroomId: nextClassroomId,
      enabled: nextEnabled,
      onStateChange,
    });

    useEffect(() => {
      hookState.current = hook.refreshCollaborationState;
    }, [hook]);

    return createElement('div');
  }

  const render = async () => {
    await act(async () => {
      root.render(createElement(Harness, { nextClassroomId: classroomId, nextEnabled: enabled }));
    });
  };

  await render();

  return {
    rerender: async (nextClassroomId = classroomId, nextEnabled = enabled) => {
      classroomId = nextClassroomId;
      enabled = nextEnabled;
      await render();
    },
    refresh: async (silent = false) => {
      await act(async () => {
        await hookState.current?.(silent);
      });
    },
  };
}

describe('useClassroomCollaborationState', () => {
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
      if (!mounted) {
        continue;
      }

      await act(async () => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
  });

  it('prefers SSE updates while the collaboration stream is healthy', async () => {
    const bootstrapState = buildCollaborationState({ viewerSessionId: 'bootstrap-session' });
    const streamState = buildCollaborationState({
      participantCount: 2,
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
      source.emit('collaboration-state', streamState);
    });

    expect(onStateChange).toHaveBeenNthCalledWith(1, expect.objectContaining(bootstrapState));
    expect(onStateChange).toHaveBeenNthCalledWith(2, streamState);

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling on disconnect and reconnects cleanly', async () => {
    const bootstrapState = buildCollaborationState();
    const reconnectedState = buildCollaborationState({
      collaborationState: 'frozen',
      viewerInteractionReason: 'frozen',
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
      secondSource.emit('collaboration-state', reconnectedState);
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

  it('queues a manual refresh while a fetch is already in flight', async () => {
    const bootstrapState = buildCollaborationState({ viewerSessionId: 'bootstrap-session' });
    const refreshedState = buildCollaborationState({
      collaborationState: 'frozen',
      viewerInteractionReason: 'frozen',
      viewerSessionId: 'queued-session',
    });
    const onStateChange = vi.fn();

    let resolveFirstFetch: ((value: unknown) => void) | undefined;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstFetch = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          ...refreshedState,
        }),
      });

    const mounted = await mountHook(onStateChange);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const queuedRefresh = mounted.refresh(true);

    await act(async () => {
      resolveFirstFetch?.({
        ok: true,
        json: async () => ({
          success: true,
          ...bootstrapState,
        }),
      });
      await queuedRefresh;
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onStateChange).toHaveBeenNthCalledWith(1, expect.objectContaining(bootstrapState));
    expect(onStateChange).toHaveBeenNthCalledWith(2, expect.objectContaining(refreshedState));
  });
});

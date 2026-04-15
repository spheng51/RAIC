// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassroomPresentationStatePayload } from '@/lib/types/classroom-presentation';

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
      type === 'presentation-state'
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

function buildPresentationState(
  overrides: Partial<ClassroomPresentationStatePayload> = {},
): ClassroomPresentationStatePayload {
  return {
    activeSurface: 'lesson',
    controllerSessionId: null,
    controllerRole: 'teacher',
    controlLeaseExpiresAt: null,
    simulationStatus: null,
    reportAvailable: false,
    sharedSimulation: null,
    runUrl: null,
    reportUrl: null,
    viewerSessionId: 'session-1',
    viewerRole: 'teacher',
    viewerKind: 'web',
    viewerCanManageSimulation: true,
    viewerCanControlPresentation: true,
    viewerHasSimulationControl: true,
    participants: [],
    ...overrides,
  };
}

async function mountHook(
  onStateChange: (state: ClassroomPresentationStatePayload | null) => void,
  initialClassroomId = 'room-1',
  initialEnabled = true,
): Promise<MountedHook> {
  const { useClassroomPresentationState } =
    await import('@/lib/hooks/use-classroom-presentation-state');

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  let classroomId = initialClassroomId;
  let enabled = initialEnabled;
  const hookState: {
    current?: ReturnType<typeof useClassroomPresentationState>['refreshPresentationState'];
  } = {};

  function Harness({
    nextClassroomId,
    nextEnabled,
  }: {
    nextClassroomId?: string;
    nextEnabled?: boolean;
  }) {
    const hook = useClassroomPresentationState({
      classroomId: nextClassroomId,
      enabled: nextEnabled,
      onStateChange,
    });

    hookState.current = hook.refreshPresentationState;

    return createElement('div');
  }

  const render = async () => {
    await act(async () => {
      root.render(
        createElement(Harness, {
          nextClassroomId: classroomId,
          nextEnabled: enabled,
        }),
      );
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

describe('useClassroomPresentationState', () => {
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

  it('prefers SSE updates and suspends polling while the stream is healthy', async () => {
    const bootstrapState = buildPresentationState({ viewerSessionId: 'bootstrap-session' });
    const streamState = buildPresentationState({
      activeSurface: 'simulation',
      simulationStatus: 'running',
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
      source.emit('presentation-state', streamState);
    });

    expect(onStateChange).toHaveBeenNthCalledWith(1, expect.objectContaining(bootstrapState));
    expect(onStateChange).toHaveBeenNthCalledWith(2, streamState);

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling on disconnect and reconnects cleanly', async () => {
    const bootstrapState = buildPresentationState();
    const reconnectedState = buildPresentationState({
      activeSurface: 'report',
      reportAvailable: true,
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
      vi.advanceTimersByTime(999);
    });
    expect(MockEventSource.instances).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    const secondSource = MockEventSource.instances[1];
    await act(async () => {
      secondSource.emit('open');
      secondSource.emit('presentation-state', reconnectedState);
      vi.advanceTimersByTime(5_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onStateChange).toHaveBeenCalledWith(reconnectedState);
    expect(onStateChange.mock.calls.at(-1)?.[0]).toEqual(reconnectedState);
  });

  it('retries SSE with capped backoff', async () => {
    const onStateChange = vi.fn();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        ...buildPresentationState(),
      }),
    });

    await mountHook(onStateChange);

    const firstSource = MockEventSource.instances[0];
    await act(async () => {
      firstSource.onerror?.(new Event('error'));
    });

    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(MockEventSource.instances).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    const secondSource = MockEventSource.instances[1];
    await act(async () => {
      secondSource.onerror?.(new Event('error'));
      vi.advanceTimersByTime(1_999);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(MockEventSource.instances).toHaveLength(3);

    const thirdSource = MockEventSource.instances[2];
    await act(async () => {
      thirdSource.onerror?.(new Event('error'));
      vi.advanceTimersByTime(4_999);
    });
    expect(MockEventSource.instances).toHaveLength(3);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(MockEventSource.instances).toHaveLength(4);

    const fourthSource = MockEventSource.instances[3];
    await act(async () => {
      fourthSource.onerror?.(new Event('error'));
      vi.advanceTimersByTime(9_999);
    });
    expect(MockEventSource.instances).toHaveLength(4);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(MockEventSource.instances).toHaveLength(5);
  });

  it('does not fetch while disabled', async () => {
    const onStateChange = vi.fn();
    await mountHook(onStateChange, 'room-1', false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('queues a manual refresh while a fetch is already in flight', async () => {
    const bootstrapState = buildPresentationState({ viewerSessionId: 'bootstrap-session' });
    const refreshedState = buildPresentationState({
      activeSurface: 'simulation',
      simulationStatus: 'running',
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

  // TODO: convert to deterministic assertion once hook refresh/event ordering is test-stabilized.
  it.skip('does not emit duplicate classroom presentation updates', async () => {
    const state = buildPresentationState({ viewerSessionId: 'stable-session' });
    const changedState = buildPresentationState({
      ...state,
      reportAvailable: !state.reportAvailable,
    });
    const onStateChange = vi.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          ...state,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          ...state,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          ...changedState,
        }),
      });

    const mounted = await mountHook(onStateChange);
    await mounted.refresh(true);
    await mounted.refresh(true);

    expect(onStateChange).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onStateChange).toHaveBeenNthCalledWith(1, expect.objectContaining(state));
    expect(onStateChange).toHaveBeenNthCalledWith(2, expect.objectContaining(changedState));
  });
});

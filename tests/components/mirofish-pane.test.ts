// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MountedComponent<TProps> {
  readonly container: HTMLDivElement;
  readonly rerender: (nextProps?: Partial<TProps>) => Promise<void>;
}

interface MiroFishPaneTestProps {
  readonly activeSurface: 'simulation' | 'report';
  readonly simulationId: string;
  readonly reportId: string | null;
  readonly runUrl: string | null;
  readonly reportUrl: string | null;
  readonly viewerHasSimulationControl: boolean;
  readonly viewerCanManageSimulation: boolean;
  readonly controllerRole: 'teacher' | 'student';
  readonly controllerDisplayName: string;
  readonly controlLeaseExpiresAt: string | null;
  readonly onEvent?: (event: unknown) => void;
  readonly onReclaimControl?: () => void;
  readonly onRecoverToLesson?: (message: string) => void;
}

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

async function mountMiroFishPane(
  initialOverrides: Partial<MiroFishPaneTestProps> = {},
): Promise<MountedComponent<MiroFishPaneTestProps>> {
  const { MiroFishPane } = await import('@/components/mirofish/mirofish-pane');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  let props: MiroFishPaneTestProps = {
    activeSurface: 'simulation',
    simulationId: 'sim-1',
    reportId: 'report-1',
    runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=token-a',
    reportUrl: 'https://mirofish.example/report/report-1?embed=1&classroomToken=report-token-a',
    viewerHasSimulationControl: true,
    viewerCanManageSimulation: true,
    controllerRole: 'teacher',
    controllerDisplayName: 'Teacher One',
    controlLeaseExpiresAt: null,
    ...initialOverrides,
  };

  const renderWithProps = async () => {
    await act(async () => {
      root.render(createElement(MiroFishPane, props));
    });
  };

  await renderWithProps();

  return {
    container,
    rerender: async (nextProps = {}) => {
      props = {
        ...props,
        ...nextProps,
      };
      await renderWithProps();
    },
  };
}

describe('MiroFishPane', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    vi.useRealTimers();
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

  it('keeps the current iframe source pinned across token-only URL updates', async () => {
    const mounted = await mountMiroFishPane();
    const initialIframe = mounted.container.querySelector('iframe');
    expect(initialIframe?.getAttribute('src')).toBe(
      'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=token-a',
    );

    await mounted.rerender({
      runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=token-b',
    });

    const updatedIframe = mounted.container.querySelector('iframe');
    expect(updatedIframe).toBe(initialIframe);
    expect(updatedIframe?.getAttribute('src')).toBe(
      'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=token-a',
    );
  });

  it('uses the latest token on retry and starts a fresh watchdog attempt', async () => {
    vi.useFakeTimers();
    const onRecoverToLesson = vi.fn();
    const mounted = await mountMiroFishPane({ onRecoverToLesson });

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });

    expect(onRecoverToLesson).toHaveBeenCalledTimes(1);

    await mounted.rerender({
      runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=token-b',
    });

    onRecoverToLesson.mockClear();

    const retryButton = Array.from(mounted.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Retry MiroFish'),
    );
    expect(retryButton).toBeTruthy();

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const iframe = mounted.container.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toBe(
      'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=token-b',
    );

    await act(async () => {
      vi.advanceTimersByTime(14_999);
    });
    expect(onRecoverToLesson).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onRecoverToLesson).toHaveBeenCalledTimes(1);
  });

  it('clears the watchdog after a ready event', async () => {
    vi.useFakeTimers();
    const onEvent = vi.fn();
    const onRecoverToLesson = vi.fn();
    await mountMiroFishPane({
      onEvent,
      onRecoverToLesson,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://mirofish.example',
          data: {
            type: 'ready',
          },
        }),
      );
    });

    expect(onEvent).toHaveBeenCalledWith({ type: 'ready' });

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });

    expect(onRecoverToLesson).not.toHaveBeenCalled();
  });

  it('falls back only once for a hung iframe attempt', async () => {
    vi.useFakeTimers();
    const onEvent = vi.fn();
    const onRecoverToLesson = vi.fn();

    await mountMiroFishPane({
      onEvent,
      onRecoverToLesson,
    });

    await act(async () => {
      vi.advanceTimersByTime(45_000);
    });

    expect(onRecoverToLesson).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      type: 'error',
      message: 'MiroFish took too long to load. Returning the classroom to the lesson view.',
    });
  });

  it('shows the controller name and lease countdown in the read-only overlay', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));

    const mounted = await mountMiroFishPane({
      viewerHasSimulationControl: false,
      viewerCanManageSimulation: false,
      controllerRole: 'student',
      controllerDisplayName: 'Student One',
      controlLeaseExpiresAt: '2026-04-11T00:05:00.000Z',
    });

    expect(mounted.container.textContent).toContain(
      'Student One currently has control of the shared simulation.',
    );
    expect(mounted.container.textContent).toContain('Lease: 5m 00s remaining');
  });
});

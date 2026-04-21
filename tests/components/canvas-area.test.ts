// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scene, SharedSimulation } from '@/lib/types/stage';

let miroFishMountCount = 0;
let miroFishUnmountCount = 0;

vi.mock('motion/react', async () => {
  const React = await import('react');
  return {
    motion: {
      div: ({
        children,
        ...props
      }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) =>
        React.createElement('div', props, children),
    },
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (value: string) => value,
  }),
}));

vi.mock('@/components/stage/scene-renderer', async () => {
  const React = await import('react');
  return {
    SceneRenderer: () => React.createElement('div', { 'data-testid': 'scene-renderer' }),
  };
});

vi.mock('@/lib/contexts/scene-context', async () => {
  const React = await import('react');
  return {
    SceneProvider: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock('@/components/whiteboard', async () => {
  const React = await import('react');
  return {
    Whiteboard: () => React.createElement('div', { 'data-testid': 'whiteboard' }),
  };
});

vi.mock('@/components/canvas/canvas-toolbar', async () => {
  const React = await import('react');
  return {
    CanvasToolbar: () => React.createElement('div', { 'data-testid': 'canvas-toolbar' }),
  };
});

vi.mock('@/components/mirofish/mirofish-pane', async () => {
  const React = await import('react');
  return {
    MiroFishPane: (props: {
      readonly simulationId: string;
      readonly reportId: string | null;
      readonly runUrl: string | null;
      readonly activeSurface: 'simulation' | 'report';
    }) => {
      React.useEffect(() => {
        miroFishMountCount += 1;
        return () => {
          miroFishUnmountCount += 1;
        };
      }, []);

      return React.createElement('div', {
        'data-testid': 'mirofish-pane',
        'data-simulation-id': props.simulationId,
        'data-report-id': props.reportId ?? '',
        'data-run-url': props.runUrl ?? '',
        'data-active-surface': props.activeSurface,
      });
    },
  };
});

interface CanvasAreaTestProps {
  readonly sharedSimulation: SharedSimulation | null;
  readonly activeSurface: 'lesson' | 'simulation' | 'report';
  readonly runUrl: string | null;
  readonly reportUrl: string | null;
  readonly currentScene: Scene | null;
  readonly onPlayPause: () => void;
}

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function buildSharedSimulation(overrides: Partial<SharedSimulation> = {}): SharedSimulation {
  return {
    provider: 'mirofish',
    simulationId: 'sim-1',
    reportId: 'report-1',
    runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=token-a',
    reportUrl: 'https://mirofish.example/report/report-1?embed=1&classroomToken=report-token-a',
    activeSurface: 'simulation',
    controllerRole: 'teacher',
    status: 'attached',
    ...overrides,
  };
}

function buildSlideScene(): Scene {
  return {
    id: 'scene-1',
    stageId: 'stage-1',
    type: 'slide',
    title: 'Slide scene',
    order: 0,
    content: {
      type: 'slide',
      canvas: {
        id: 'slide-1',
        viewportSize: 1000,
        viewportRatio: 0.5625,
        theme: {
          backgroundColor: '#ffffff',
          themeColors: ['#111111'],
          fontColor: '#111111',
          fontName: 'Inter',
        },
        elements: [],
      },
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function mountCanvasArea(initialOverrides: Partial<CanvasAreaTestProps> = {}): Promise<{
  readonly container: HTMLDivElement;
  readonly rerender: (nextProps?: Partial<CanvasAreaTestProps>) => Promise<void>;
}> {
  const { CanvasArea } = await import('@/components/canvas/canvas-area');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  let props: CanvasAreaTestProps = {
    sharedSimulation: buildSharedSimulation(),
    activeSurface: 'simulation',
    runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=token-a',
    reportUrl: 'https://mirofish.example/report/report-1?embed=1&classroomToken=report-token-a',
    currentScene: null,
    onPlayPause: vi.fn(),
    ...initialOverrides,
  };

  const renderWithProps = async () => {
    await act(async () => {
      root.render(
        createElement(CanvasArea, {
          currentScene: props.currentScene,
          currentSceneIndex: 0,
          scenesCount: 1,
          mode: 'playback',
          engineState: 'idle',
          isLiveSession: false,
          whiteboardOpen: false,
          sidebarCollapsed: false,
          chatCollapsed: false,
          onToggleSidebar: vi.fn(),
          onToggleChat: vi.fn(),
          onPrevSlide: vi.fn(),
          onNextSlide: vi.fn(),
          onPlayPause: props.onPlayPause,
          onWhiteboardClose: vi.fn(),
          isPresenting: false,
          onTogglePresentation: vi.fn(),
          showStopDiscussion: false,
          onStopDiscussion: vi.fn(),
          hideToolbar: true,
          isPendingScene: false,
          isGenerationFailed: false,
          onRetryGeneration: vi.fn(),
          sharedSimulation: props.sharedSimulation,
          activeSurface: props.activeSurface,
          reportAvailable: Boolean(props.sharedSimulation?.reportId),
          viewerCanManageSimulation: true,
          viewerCanControlPresentation: true,
          onSetPresentationSurface: vi.fn(),
          onOpenMiroFishManager: vi.fn(),
          runUrl: props.runUrl,
          reportUrl: props.reportUrl,
          viewerHasSimulationControl: true,
          presentationFallbackMessage: null,
          onMiroFishEvent: vi.fn(),
          onReclaimMiroFishControl: vi.fn(),
          onRecoverToLesson: vi.fn(),
        }),
      );
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

describe('CanvasArea', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    miroFishMountCount = 0;
    miroFishUnmountCount = 0;
  });

  afterEach(async () => {
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

  it('does not remount the MiroFish pane when only the tokenized URL changes', async () => {
    const mounted = await mountCanvasArea();
    const pane = mounted.container.querySelector('[data-testid="mirofish-pane"]');
    expect(pane?.getAttribute('data-run-url')).toBe(
      'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=token-a',
    );
    expect(miroFishMountCount).toBe(1);
    expect(miroFishUnmountCount).toBe(0);

    await mounted.rerender({
      runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=token-b',
    });

    const updatedPane = mounted.container.querySelector('[data-testid="mirofish-pane"]');
    expect(updatedPane?.getAttribute('data-run-url')).toBe(
      'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=token-b',
    );
    expect(miroFishMountCount).toBe(1);
    expect(miroFishUnmountCount).toBe(0);
  });

  it('remounts the MiroFish pane when the attached simulation changes', async () => {
    const mounted = await mountCanvasArea();
    expect(miroFishMountCount).toBe(1);
    expect(miroFishUnmountCount).toBe(0);

    await mounted.rerender({
      sharedSimulation: buildSharedSimulation({
        simulationId: 'sim-2',
        runUrl: 'https://mirofish.example/simulation/sim-2/start?embed=1&classroomToken=token-c',
      }),
      runUrl: 'https://mirofish.example/simulation/sim-2/start?embed=1&classroomToken=token-c',
    });

    const updatedPane = mounted.container.querySelector('[data-testid="mirofish-pane"]');
    expect(updatedPane?.getAttribute('data-simulation-id')).toBe('sim-2');
    expect(miroFishMountCount).toBe(2);
    expect(miroFishUnmountCount).toBe(1);
  });

  it('exposes keyboard playback controls for slide scenes on the lesson surface', async () => {
    const onPlayPause = vi.fn();
    const mounted = await mountCanvasArea({
      sharedSimulation: null,
      activeSurface: 'lesson',
      runUrl: null,
      reportUrl: null,
      currentScene: buildSlideScene(),
      onPlayPause,
    });

    const playbackSurface = mounted.container.querySelector('[role="button"]') as HTMLDivElement;
    expect(playbackSurface).toBeTruthy();
    expect(playbackSurface.getAttribute('aria-label')).toBe('roundtable.play');

    await act(async () => {
      playbackSurface.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
        }),
      );
    });

    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });
});

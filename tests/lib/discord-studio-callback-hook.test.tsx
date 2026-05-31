// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClassroomLaunchMode } from '@/lib/utils/classroom-launch';
import { useDiscordStudioCallback } from '@/lib/hooks/use-discord-studio-callback';

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: toastMocks,
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function CallbackHarness({
  launchMode = 'teacher-server',
  refreshConnection,
}: {
  launchMode?: ClassroomLaunchMode;
  refreshConnection: () => void;
}) {
  useDiscordStudioCallback({
    launchMode,
    refreshConnection,
    t: (key) => `translated:${key}`,
  });
  return null;
}

async function renderHarness(props: {
  launchMode?: ClassroomLaunchMode;
  refreshConnection: () => void;
}) {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(createElement(CallbackHarness, props));
    await Promise.resolve();
  });

  return {
    rerender: async (nextProps = props) => {
      await act(async () => {
        root.render(createElement(CallbackHarness, nextProps));
        await Promise.resolve();
      });
    },
  };
}

afterEach(() => {
  mountedRoots.splice(0).forEach(({ root, container }) => {
    act(() => root.unmount());
    container.remove();
  });
  toastMocks.error.mockReset();
  toastMocks.success.mockReset();
  window.history.replaceState(null, '', '/');
});

describe('useDiscordStudioCallback', () => {
  it('shows success feedback, refreshes Discord state, and scrubs the Studio callback URL', async () => {
    const refreshConnection = vi.fn();
    window.history.replaceState(null, '', '/studio?discord=connected&keep=1#schedule');

    const mounted = await renderHarness({ refreshConnection });

    expect(toastMocks.success).toHaveBeenCalledWith('translated:home.schedule.discord.connected');
    expect(toastMocks.error).not.toHaveBeenCalled();
    expect(refreshConnection).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/studio');
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.hash).toBe('#schedule');

    await mounted.rerender();

    expect(toastMocks.success).toHaveBeenCalledTimes(1);
    expect(refreshConnection).toHaveBeenCalledTimes(1);
  });

  it('shows error feedback for invalid state callbacks', async () => {
    const refreshConnection = vi.fn();
    window.history.replaceState(null, '', '/studio?discord=invalid_state');

    await renderHarness({ refreshConnection });

    expect(toastMocks.error).toHaveBeenCalledWith('translated:home.schedule.discord.invalidState');
    expect(toastMocks.success).not.toHaveBeenCalled();
    expect(refreshConnection).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('');
  });

  it.each([
    ['error', 'translated:home.schedule.discord.connectionFailed'],
    ['missing_guild', 'translated:home.schedule.discord.missingGuild'],
  ])('shows recoverable feedback for %s callbacks once', async (status, message) => {
    const refreshConnection = vi.fn();
    window.history.replaceState(null, '', `/studio?discord=${status}&keep=1#schedule`);

    const mounted = await renderHarness({ refreshConnection });

    expect(toastMocks.error).toHaveBeenCalledWith(message);
    expect(toastMocks.success).not.toHaveBeenCalled();
    expect(refreshConnection).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/studio');
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.hash).toBe('#schedule');

    await mounted.rerender();

    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(refreshConnection).toHaveBeenCalledTimes(1);
  });

  it('ignores Discord callback params outside teacher-server mode', async () => {
    const refreshConnection = vi.fn();
    window.history.replaceState(null, '', '/?discord=connected');

    await renderHarness({ launchMode: 'public-demo', refreshConnection });

    expect(toastMocks.success).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
    expect(refreshConnection).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?discord=connected');
  });
});

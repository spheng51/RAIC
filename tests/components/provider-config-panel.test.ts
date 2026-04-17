// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '@/lib/ai/providers';
import type { ProvidersConfig } from '@/lib/types/settings';

vi.mock('@/components/ui/button', async () => {
  const React = await import('react');
  return {
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
      React.createElement('button', props, children),
  };
});

vi.mock('@/components/ui/input', async () => {
  const React = await import('react');
  return {
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
      React.createElement('input', props),
  };
});

vi.mock('@/components/ui/label', async () => {
  const React = await import('react');
  return {
    Label: ({
      children,
      ...props
    }: React.LabelHTMLAttributes<HTMLLabelElement> & { children?: React.ReactNode }) =>
      React.createElement('label', props, children),
  };
});

vi.mock('@/components/ui/checkbox', async () => {
  const React = await import('react');
  return {
    Checkbox: ({
      checked,
      onCheckedChange,
      ...props
    }: {
      checked?: boolean;
      onCheckedChange?: (checked: boolean) => void;
    } & React.InputHTMLAttributes<HTMLInputElement>) =>
      React.createElement('input', {
        ...props,
        type: 'checkbox',
        checked,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onCheckedChange?.(event.target.checked),
      }),
  };
});

vi.mock('@/components/ui/switch', async () => {
  const React = await import('react');
  return {
    Switch: ({
      checked,
      onCheckedChange,
      ...props
    }: {
      checked?: boolean;
      onCheckedChange?: (checked: boolean) => void;
    } & React.InputHTMLAttributes<HTMLInputElement>) =>
      React.createElement('input', {
        ...props,
        type: 'checkbox',
        role: 'switch',
        checked,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onCheckedChange?.(event.target.checked),
      }),
  };
});

vi.mock('@/components/ui/alert-dialog', async () => {
  const React = await import('react');
  return {
    AlertDialog: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    AlertDialogAction: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
      React.createElement('button', props, children),
    AlertDialogCancel: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
      React.createElement('button', props, children),
    AlertDialogContent: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    AlertDialogDescription: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('p', null, children),
    AlertDialogFooter: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    AlertDialogHeader: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    AlertDialogTitle: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('h2', null, children),
  };
});

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      if (key === 'settings.testConnection') {
        return 'Test Connection';
      }
      if (key === 'settings.hostedLocalProviderWarning') {
        return `Hosted OpenRAIC cannot reach your local ${vars?.provider ?? 'provider'} server at a localhost/private address.`;
      }
      if (key === 'settings.browserLocalModeLabel') {
        return 'Browser-local mode';
      }
      if (key === 'settings.browserLocalModeDescription') {
        return 'Send requests directly from this browser to your local model server.';
      }
      if (key === 'settings.browserLocalModeNotice') {
        return `This device will connect directly to your local ${vars?.provider ?? 'provider'} server.`;
      }
      if (key === 'settings.browserLocalPermissionHint') {
        return 'Your browser may prompt for local-network access before it can reach this device.';
      }
      if (key === 'settings.browserLocalLmstudioCorsHint') {
        return `LM Studio must allow browser CORS for browser-local mode. If needed, start the local server with ${vars?.command ?? 'command'}.`;
      }
      if (key === 'settings.noModelsAvailable') {
        return 'No models available for testing';
      }
      if (key === 'settings.connectionSuccess') {
        return 'Connection successful';
      }
      if (key === 'settings.connectionFailed') {
        return 'Connection failed';
      }
      return key;
    },
  }),
}));

const mockSettingsState = {
  aiPolicy: { allowPersonalCustomBaseUrls: true },
  providerId: 'lmstudio',
  modelId: 'qwen/qwen3.5-35b-a3b',
};

vi.mock('@/lib/store/settings', () => ({
  useSettingsStore: (selector: (state: typeof mockSettingsState) => unknown) =>
    selector(mockSettingsState),
}));

interface MountedPanel {
  readonly container: HTMLDivElement;
  readonly onConfigChange: ReturnType<typeof vi.fn>;
}

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function buildProvider(providerId: 'lmstudio' | 'ollama' | 'openai'): ProviderConfig {
  if (providerId === 'openai') {
    return {
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      requiresApiKey: true,
      models: [],
    };
  }

  return {
    id: providerId,
    name: providerId === 'lmstudio' ? 'LM Studio' : 'Ollama',
    type: 'openai',
    defaultBaseUrl:
      providerId === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : 'http://127.0.0.1:11434/v1',
    requiresApiKey: false,
    supportsOptionalApiKey: true,
    models: [],
  };
}

function buildProvidersConfig(
  provider: ProviderConfig,
  baseUrl: string,
  transportMode: 'server' | 'browser-local',
): ProvidersConfig {
  const modelId = provider.id === 'openai' ? 'gpt-4o' : 'qwen/qwen3.5-35b-a3b';
  return {
    [provider.id]: {
      name: provider.name,
      type: provider.type,
      isBuiltIn: true,
      apiKey: '',
      baseUrl,
      requiresApiKey: provider.requiresApiKey,
      supportsOptionalApiKey: provider.supportsOptionalApiKey,
      transportMode,
      models: [
        {
          id: modelId,
          name: modelId,
          capabilities: {
            vision: true,
            tools: true,
            streaming: true,
          },
        },
      ],
    },
  } as ProvidersConfig;
}

async function mountProviderConfigPanel({
  providerId = 'lmstudio',
  originHostname,
  transportMode = 'server',
  baseUrl,
}: {
  providerId?: 'lmstudio' | 'ollama' | 'openai';
  originHostname: string;
  transportMode?: 'server' | 'browser-local';
  baseUrl?: string;
}): Promise<MountedPanel> {
  const { ProviderConfigPanel } = await import('@/components/settings/provider-config-panel');
  const provider = buildProvider(providerId);
  const resolvedBaseUrl = baseUrl ?? provider.defaultBaseUrl ?? '';
  const providersConfig = buildProvidersConfig(provider, resolvedBaseUrl, transportMode);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  const onConfigChange = vi.fn();

  await act(async () => {
    root.render(
      createElement(ProviderConfigPanel, {
        provider,
        initialApiKey: '',
        initialBaseUrl: resolvedBaseUrl,
        initialRequiresApiKey: provider.requiresApiKey,
        initialTransportMode: transportMode,
        originHostname,
        providersConfig,
        onConfigChange,
        onSave: vi.fn(),
        onEditModel: vi.fn(),
        onDeleteModel: vi.fn(),
        onAddModel: vi.fn(),
        isBuiltIn: true,
      }),
    );
  });

  return { container, onConfigChange };
}

describe('ProviderConfigPanel', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
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

  it('shows the browser-local toggle for LM Studio and Ollama only', async () => {
    const lmstudio = await mountProviderConfigPanel({
      providerId: 'lmstudio',
      originHostname: 'open-raic.com',
    });
    expect(lmstudio.container.querySelector('#browser-local-mode-lmstudio')).not.toBeNull();

    const ollama = await mountProviderConfigPanel({
      providerId: 'ollama',
      originHostname: 'open-raic.com',
    });
    expect(ollama.container.querySelector('#browser-local-mode-ollama')).not.toBeNull();

    const openai = await mountProviderConfigPanel({
      providerId: 'openai',
      originHostname: 'open-raic.com',
    });
    expect(openai.container.querySelector('#browser-local-mode-openai')).toBeNull();
    expect(openai.container.textContent).not.toContain('Browser-local mode');
  });

  it('shows the hosted warning in server mode and swaps to device-local guidance in browser-local mode', async () => {
    const mounted = await mountProviderConfigPanel({
      providerId: 'lmstudio',
      originHostname: 'open-raic.com',
    });

    expect(mounted.container.textContent).toContain(
      'Hosted OpenRAIC cannot reach your local LM Studio server at a localhost/private address.',
    );
    expect(mounted.container.textContent).not.toContain(
      'This device will connect directly to your local LM Studio server.',
    );

    const testButton = mounted.container.querySelector(
      '[data-testid="provider-test-lmstudio"]',
    ) as HTMLButtonElement | null;

    expect(testButton).not.toBeNull();
    expect(testButton?.disabled).toBe(true);

    const toggle = mounted.container.querySelector(
      '#browser-local-mode-lmstudio',
    ) as HTMLInputElement | null;

    expect(toggle).not.toBeNull();

    await act(async () => {
      toggle?.click();
    });

    expect(mounted.onConfigChange).toHaveBeenLastCalledWith(
      '',
      'http://127.0.0.1:1234/v1',
      false,
      'browser-local',
    );
    expect(mounted.container.textContent).not.toContain(
      'Hosted OpenRAIC cannot reach your local LM Studio server at a localhost/private address.',
    );
    expect(mounted.container.textContent).toContain(
      'This device will connect directly to your local LM Studio server.',
    );
    expect(mounted.container.textContent).toContain(
      'Your browser may prompt for local-network access before it can reach this device.',
    );
    expect(mounted.container.textContent).toContain(
      'LM Studio must allow browser CORS for browser-local mode. If needed, start the local server with lms server start --cors.',
    );
    expect(testButton?.disabled).toBe(false);
  });

  it('shows the permission hint without the LM Studio CORS note for Ollama browser-local mode', async () => {
    const mounted = await mountProviderConfigPanel({
      providerId: 'ollama',
      originHostname: 'open-raic.com',
    });

    const toggle = mounted.container.querySelector(
      '#browser-local-mode-ollama',
    ) as HTMLInputElement | null;

    expect(toggle).not.toBeNull();

    await act(async () => {
      toggle?.click();
    });

    expect(mounted.container.textContent).toContain(
      'This device will connect directly to your local Ollama server.',
    );
    expect(mounted.container.textContent).toContain(
      'Your browser may prompt for local-network access before it can reach this device.',
    );
    expect(mounted.container.textContent).not.toContain(
      'LM Studio must allow browser CORS for browser-local mode.',
    );
  });

  it('keeps testing enabled for local OpenRAIC origins', async () => {
    const mounted = await mountProviderConfigPanel({
      providerId: 'lmstudio',
      originHostname: 'localhost',
    });

    expect(mounted.container.textContent).not.toContain(
      'Hosted OpenRAIC cannot reach your local LM Studio server at a localhost/private address.',
    );

    const testButton = mounted.container.querySelector(
      '[data-testid="provider-test-lmstudio"]',
    ) as HTMLButtonElement | null;

    expect(testButton).not.toBeNull();
    expect(testButton?.disabled).toBe(false);

    const toggle = mounted.container.querySelector(
      '#browser-local-mode-lmstudio',
    ) as HTMLInputElement | null;

    expect(toggle).not.toBeNull();

    await act(async () => {
      toggle?.click();
    });

    expect(mounted.container.textContent).toContain(
      'This device will connect directly to your local LM Studio server.',
    );
    expect(mounted.container.textContent).not.toContain(
      'Your browser may prompt for local-network access before it can reach this device.',
    );
    expect(mounted.container.textContent).toContain(
      'LM Studio must allow browser CORS for browser-local mode. If needed, start the local server with lms server start --cors.',
    );
  });
});

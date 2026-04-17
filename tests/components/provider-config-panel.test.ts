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
}

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

const provider: ProviderConfig = {
  id: 'lmstudio',
  name: 'LM Studio',
  type: 'openai',
  defaultBaseUrl: 'http://127.0.0.1:1234/v1',
  requiresApiKey: false,
  supportsOptionalApiKey: true,
  models: [],
};

const providersConfig = {
  lmstudio: {
    name: 'LM Studio',
    type: 'openai',
    isBuiltIn: true,
    apiKey: '',
    baseUrl: 'http://127.0.0.1:1234/v1',
    requiresApiKey: false,
    models: [
      {
        id: 'qwen/qwen3.5-35b-a3b',
        name: 'qwen/qwen3.5-35b-a3b',
        capabilities: {
          vision: true,
          tools: true,
          streaming: true,
        },
      },
    ],
  },
} as ProvidersConfig;

async function mountProviderConfigPanel(originHostname: string): Promise<MountedPanel> {
  const { ProviderConfigPanel } = await import('@/components/settings/provider-config-panel');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(
      createElement(ProviderConfigPanel, {
        provider,
        initialApiKey: '',
        initialBaseUrl: 'http://127.0.0.1:1234/v1',
        initialRequiresApiKey: false,
        originHostname,
        providersConfig,
        onConfigChange: vi.fn(),
        onSave: vi.fn(),
        onEditModel: vi.fn(),
        onDeleteModel: vi.fn(),
        onAddModel: vi.fn(),
        isBuiltIn: true,
      }),
    );
  });

  return { container };
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

  it('shows a hosted-topology warning and disables testing for hosted LM Studio localhost URLs', async () => {
    const mounted = await mountProviderConfigPanel('open-raic.com');

    expect(mounted.container.textContent).toContain(
      'Hosted OpenRAIC cannot reach your local LM Studio server at a localhost/private address.',
    );

    const testButton = mounted.container.querySelector(
      '[data-testid="provider-test-lmstudio"]',
    ) as HTMLButtonElement | null;

    expect(testButton).not.toBeNull();
    expect(testButton?.disabled).toBe(true);
  });

  it('keeps testing enabled for local OpenRAIC origins', async () => {
    const mounted = await mountProviderConfigPanel('localhost');

    expect(mounted.container.textContent).not.toContain(
      'Hosted OpenRAIC cannot reach your local LM Studio server at a localhost/private address.',
    );

    const testButton = mounted.container.querySelector(
      '[data-testid="provider-test-lmstudio"]',
    ) as HTMLButtonElement | null;

    expect(testButton).not.toBeNull();
    expect(testButton?.disabled).toBe(false);
  });
});

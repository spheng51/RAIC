// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/dialog', async () => {
  const React = await import('react');
  return {
    Dialog: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    DialogContent: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    DialogTitle: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('h2', null, children),
    DialogDescription: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('p', null, children),
  };
});

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

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      if (key === 'settings.browserLocalModeNotice') {
        return `This device will connect directly to your local ${vars?.provider ?? 'provider'} server.`;
      }
      if (key === 'settings.browserLocalPermissionHint') {
        return 'Your browser may prompt for local-network access before it can reach this device.';
      }
      if (key === 'settings.browserLocalLmstudioCorsHint') {
        return `LM Studio must allow browser CORS for browser-local mode. If needed, start the local server with ${vars?.command ?? 'command'}.`;
      }
      if (key === 'settings.hostedLocalProviderWarning') {
        return `Hosted Open-RAIC cannot reach your local ${vars?.provider ?? 'provider'} server at a localhost/private address.`;
      }
      if (key === 'settings.testConnection') {
        return 'Test Connection';
      }
      if (key === 'settings.testing') {
        return 'Testing...';
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

vi.mock('@/lib/ai/providers', () => ({
  getProvider: (providerId: string) => ({
    id: providerId,
    name: providerId === 'lmstudio' ? 'LM Studio' : 'Ollama',
  }),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createSseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(events.join('')));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function mountModelEditDialog({
  originHostname,
  providerId = 'lmstudio',
}: {
  originHostname: string;
  providerId?: 'lmstudio' | 'ollama';
}) {
  const { ModelEditDialog } = await import('@/components/settings/model-edit-dialog');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  const editingModel = {
    providerId,
    modelIndex: 0,
    model: {
      id: providerId === 'lmstudio' ? 'qwen/qwen3.5-35b-a3b' : 'llama3.1',
      name: providerId === 'lmstudio' ? 'qwen/qwen3.5-35b-a3b' : 'llama3.1',
      capabilities: {
        vision: false,
        tools: false,
        streaming: true,
      },
    },
  };

  await act(async () => {
    root.render(
      createElement(ModelEditDialog, {
        open: true,
        onOpenChange: vi.fn(),
        editingModel,
        setEditingModel: vi.fn(),
        onSave: vi.fn(),
        onAutoSave: vi.fn(),
        providerId,
        apiKey: '',
        baseUrl:
          providerId === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : 'http://127.0.0.1:11434/v1',
        effectiveBaseUrl:
          providerId === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : 'http://127.0.0.1:11434/v1',
        originHostname,
        transportMode: 'browser-local',
        providerType: 'openai',
        requiresApiKey: false,
        isServerConfigured: false,
      }),
    );
  });

  return { container };
}

describe('ModelEditDialog', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) continue;

      await act(async () => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
  });

  it('shows hosted browser-local prerequisite hints for LM Studio', async () => {
    const mounted = await mountModelEditDialog({
      originHostname: 'open-raic.com',
      providerId: 'lmstudio',
    });

    expect(mounted.container.textContent).toContain(
      'This device will connect directly to your local LM Studio server.',
    );
    expect(mounted.container.textContent).toContain(
      'Your browser may prompt for local-network access before it can reach this device.',
    );
    expect(mounted.container.textContent).toContain(
      'LM Studio must allow browser CORS for browser-local mode. If needed, start the local server with lms server start --cors.',
    );
  });

  it('hides the hosted-only permission hint on local origins while keeping the LM Studio CORS hint', async () => {
    const mounted = await mountModelEditDialog({
      originHostname: 'localhost',
      providerId: 'lmstudio',
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

  it('surfaces a targeted browser-local compatibility error for reasoning-only models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        createSseResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"Thinking..."}}]}\n\n',
          'data: {"choices":[{"finish_reason":"length"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );

    const mounted = await mountModelEditDialog({
      originHostname: 'open-raic.com',
      providerId: 'lmstudio',
    });

    const testButton = mounted.container.querySelector('button') as HTMLButtonElement | null;
    expect(testButton).not.toBeNull();

    await act(async () => {
      testButton?.click();
    });

    expect(mounted.container.textContent).toContain(
      'only returned reasoning output without any visible assistant text',
    );
  });
});

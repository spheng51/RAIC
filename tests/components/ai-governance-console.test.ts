// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASR_PROVIDERS, TTS_PROVIDERS } from '@/lib/audio/constants';
import { PROVIDERS } from '@/lib/ai/providers';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import type {
  AIPolicySettings,
  AIProviderFamily,
  EffectiveAIOption,
  EffectiveAIOptionsResponse,
} from '@/lib/types/ai-governance';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

const defaultPolicy: AIPolicySettings = {
  allowPersonalOverrides: true,
  allowPersonalCustomBaseUrls: true,
};

function buildOptionsForProviders<T extends { id: string }>(
  providers: Record<string, T>,
): Record<string, EffectiveAIOption> {
  return Object.values(providers).reduce<Record<string, EffectiveAIOption>>((result, provider) => {
    result[provider.id] = {
      providerId: provider.id,
      enabled: false,
      source: 'none',
      hasSecret: false,
    };
    return result;
  }, {});
}

function buildInitialOptions(): EffectiveAIOptionsResponse {
  return {
    policy: defaultPolicy,
    providers: {
      llm: buildOptionsForProviders(PROVIDERS),
      tts: buildOptionsForProviders(TTS_PROVIDERS),
      asr: buildOptionsForProviders(ASR_PROVIDERS),
      pdf: buildOptionsForProviders(PDF_PROVIDERS),
      image: buildOptionsForProviders(IMAGE_PROVIDERS),
      video: buildOptionsForProviders(VIDEO_PROVIDERS),
      webSearch: buildOptionsForProviders(WEB_SEARCH_PROVIDERS),
    } satisfies Record<AIProviderFamily, Record<string, EffectiveAIOption>>,
  };
}

async function mountConsole() {
  const { AIGovernanceConsole } = await import('@/components/admin/ai-governance-console');

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(
      createElement(AIGovernanceConsole, {
        persistenceMode: 'json',
        encryptionReady: true,
        initialConfig: {
          policy: defaultPolicy,
          configs: [],
        },
        initialOptions: buildInitialOptions(),
      }),
    );
  });

  return { container };
}

async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function keyDownElement(element: Element, key: string, code: string) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        code,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function getProviderRow(container: HTMLDivElement, family: string, providerId: string) {
  const row = container.querySelector(`[data-testid="admin-provider-${family}-${providerId}"]`);
  expect(row).toBeTruthy();
  return row as HTMLElement;
}

function getSelectedProviderHeading(container: HTMLDivElement) {
  const heading = container.querySelector('h3');
  expect(heading).toBeTruthy();
  return heading as HTMLHeadingElement;
}

describe('AIGovernanceConsole', () => {
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

  it('renders provider rows as focusable containers instead of native buttons', async () => {
    const { container } = await mountConsole();
    const openAiRow = getProviderRow(container, 'llm', 'openai');

    expect(openAiRow.tagName).toBe('DIV');
    expect(openAiRow.getAttribute('role')).toBe('button');
    expect(openAiRow.getAttribute('tabindex')).toBe('0');
    expect(openAiRow.querySelector('[role="switch"]')?.tagName).toBe('BUTTON');
  });

  it('supports keyboard row selection without letting switch interaction change selection', async () => {
    const { container } = await mountConsole();
    const heading = getSelectedProviderHeading(container);
    expect(heading.textContent).toBe(PROVIDERS.openai.name);

    const anthropicRow = getProviderRow(container, 'llm', 'anthropic');
    anthropicRow.focus();
    await keyDownElement(anthropicRow, 'Enter', 'Enter');
    expect(getSelectedProviderHeading(container).textContent).toBe(PROVIDERS.anthropic.name);

    const googleRow = getProviderRow(container, 'llm', 'google');
    googleRow.focus();
    await keyDownElement(googleRow, ' ', 'Space');
    expect(getSelectedProviderHeading(container).textContent).toBe(PROVIDERS.google.name);

    const openAiRow = getProviderRow(container, 'llm', 'openai');
    const openAiSwitch = openAiRow.querySelector('[role="switch"]');
    expect(openAiSwitch).toBeTruthy();

    await keyDownElement(openAiSwitch as Element, ' ', 'Space');
    expect(getSelectedProviderHeading(container).textContent).toBe(PROVIDERS.google.name);

    expect(openAiRow.textContent).toContain('Disabled');
    await clickElement(openAiSwitch as Element);
    expect(getSelectedProviderHeading(container).textContent).toBe(PROVIDERS.google.name);
    expect(openAiRow.textContent).toContain('Enabled');
  });
});

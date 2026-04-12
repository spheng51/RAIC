import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  APP_BASE_URL,
  addSessionCookie,
  createAuthSession,
  createOrganizationPolicy,
  createOrganizationProviderConfig,
  readPlatformStore,
  resetRaicData,
  startMockOpenAIServer,
  waitForJobToFinish,
  writePlatformStore,
} from './support/ai-governance';

test.describe.configure({ mode: 'serial' });
test.use({ locale: 'en-US' });

async function createAuthedPage(browser: Browser, token: string) {
  const context = await browser.newContext();
  await addSessionCookie(context, token);
  const page = await context.newPage();
  return { context, page };
}

async function ensureSwitchState(locator: Locator, checked: boolean) {
  await expect(locator).toBeVisible();
  const state = await locator.getAttribute('data-state');
  if ((checked && state !== 'checked') || (!checked && state !== 'unchecked')) {
    await locator.click();
  }
}

async function openStudioSettings(page: Page) {
  await page.goto(`${APP_BASE_URL}/studio`);
  await expect(page.getByTestId('settings-button')).toBeVisible();
  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
}

async function saveOrgOpenAIConfig(page: Page, params: { secret: string; baseUrl: string }) {
  await page.goto(`${APP_BASE_URL}/admin`);
  await expect(page.getByRole('heading', { name: 'Managed provider connectivity' })).toBeVisible();
  await page.getByTestId('admin-provider-llm-openai').click();
  await ensureSwitchState(page.getByTestId('org-enabled-llm-openai'), true);
  await page.getByLabel('Organization secret').fill(params.secret);
  await page.getByLabel('Base URL').fill(params.baseUrl);

  const saveResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/ai/config') && response.request().method() === 'PUT',
  );
  await page.getByTestId('save-org-ai-config').click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.ok()).toBeTruthy();
}

test.beforeEach(async () => {
  await resetRaicData();
});

test.afterAll(async () => {
  await resetRaicData();
});

test('org admin saves org defaults and teacher generates without entering a key', async ({
  browser,
}) => {
  const mockServer = await startMockOpenAIServer();
  let adminContext: BrowserContext | undefined;
  let teacherContext: BrowserContext | undefined;

  try {
    const adminSession = createAuthSession({
      role: 'org_admin',
      userId: 'admin-1',
      email: 'admin@example.com',
      displayName: 'Org Admin',
      organizationId: 'org-governed',
      organizationName: 'Governed Academy',
      organizationSlug: 'governed-academy',
    });
    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-1',
      email: 'teacher@example.com',
      displayName: 'Teacher One',
      organizationId: 'org-governed',
      organizationName: 'Governed Academy',
      organizationSlug: 'governed-academy',
    });

    await writePlatformStore({
      sessions: [adminSession, teacherSession],
      organizationAiPolicies: [
        createOrganizationPolicy({
          organizationId: 'org-governed',
          allowPersonalOverrides: true,
          allowPersonalCustomBaseUrls: true,
        }),
      ],
    });

    const admin = await createAuthedPage(browser, adminSession.token);
    adminContext = admin.context;
    await saveOrgOpenAIConfig(admin.page, {
      secret: 'org-secret',
      baseUrl: mockServer.baseUrl,
    });

    await expect
      .poll(async () => {
        const store = await readPlatformStore();
        return store.organizationProviderConfigs.length;
      })
      .toBe(1);

    const store = await readPlatformStore();
    expect(
      store.auditLogs.some((entry) => entry.action === 'organization_provider_config.updated'),
    ).toBeTruthy();

    const teacher = await createAuthedPage(browser, teacherSession.token);
    teacherContext = teacher.context;
    await openStudioSettings(teacher.page);
    await teacher.page.getByTestId('provider-item-openai').click();
    await expect(teacher.page.getByTestId('provider-api-key-openai')).toHaveValue('');

    const verifyResponse = await teacher.page.request.post(`${APP_BASE_URL}/api/verify-model`, {
      data: {
        model: 'openai:gpt-4o',
      },
    });
    const verifyBody = (await verifyResponse.json()) as { success: boolean };

    expect(verifyResponse.ok()).toBeTruthy();
    expect(verifyBody.success).toBe(true);
    await expect.poll(() => mockServer.hits.length).toBeGreaterThan(0);
    expect(mockServer.hits.at(-1)?.authorization).toBe('Bearer org-secret');
  } finally {
    await adminContext?.close();
    await teacherContext?.close();
    await mockServer.close();
  }
});

test('teacher personal override beats org default', async ({ browser }) => {
  const orgMock = await startMockOpenAIServer();
  const personalMock = await startMockOpenAIServer();
  let teacherContext: BrowserContext | undefined;

  try {
    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-override',
      email: 'teacher-override@example.com',
      displayName: 'Teacher Override',
      organizationId: 'org-governed',
      organizationName: 'Governed Academy',
      organizationSlug: 'governed-academy',
    });

    await writePlatformStore({
      sessions: [teacherSession],
      organizationAiPolicies: [
        createOrganizationPolicy({
          organizationId: 'org-governed',
          allowPersonalOverrides: true,
          allowPersonalCustomBaseUrls: true,
        }),
      ],
      organizationProviderConfigs: [
        createOrganizationProviderConfig({
          organizationId: 'org-governed',
          family: 'llm',
          providerId: 'openai',
          secret: 'org-secret',
          baseUrl: orgMock.baseUrl,
          allowedModels: ['gpt-4o'],
          defaultModel: 'gpt-4o',
          enabled: true,
        }),
      ],
    });

    const teacher = await createAuthedPage(browser, teacherSession.token);
    teacherContext = teacher.context;

    const overrideResponse = await teacher.page.request.put(`${APP_BASE_URL}/api/me/ai/overrides`, {
      data: {
        overrides: [
          {
            family: 'llm',
            providerId: 'openai',
            enabled: true,
            secret: 'personal-secret',
            baseUrl: personalMock.baseUrl,
            preferredModel: 'gpt-4o',
          },
        ],
      },
    });
    const overrideBody = (await overrideResponse.json()) as { success: boolean };

    expect(overrideResponse.ok()).toBeTruthy();
    expect(overrideBody.success).toBe(true);

    const store = await readPlatformStore();
    expect(
      store.auditLogs.some((entry) => entry.action === 'user_provider_override.updated'),
    ).toBeTruthy();

    const verifyResponse = await teacher.page.request.post(`${APP_BASE_URL}/api/verify-model`, {
      data: {
        model: 'openai:gpt-4o',
      },
    });
    const verifyBody = (await verifyResponse.json()) as { success: boolean };

    expect(verifyResponse.ok()).toBeTruthy();
    expect(verifyBody.success).toBe(true);
    await expect.poll(() => personalMock.hits.length).toBeGreaterThan(0);
    expect(orgMock.hits).toHaveLength(0);
    expect(personalMock.hits.at(-1)?.authorization).toBe('Bearer personal-secret');
  } finally {
    await teacherContext?.close();
    await orgMock.close();
    await personalMock.close();
  }
});

test('teacher cannot save a custom base URL when policy forbids it', async ({ browser }) => {
  let teacherContext: BrowserContext | undefined;

  try {
    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-policy',
      email: 'teacher-policy@example.com',
      displayName: 'Teacher Policy',
      organizationId: 'org-governed',
      organizationName: 'Governed Academy',
      organizationSlug: 'governed-academy',
    });

    await writePlatformStore({
      sessions: [teacherSession],
      organizationAiPolicies: [
        createOrganizationPolicy({
          organizationId: 'org-governed',
          allowPersonalOverrides: true,
          allowPersonalCustomBaseUrls: false,
        }),
      ],
      organizationProviderConfigs: [
        createOrganizationProviderConfig({
          organizationId: 'org-governed',
          family: 'llm',
          providerId: 'openai',
          secret: 'org-secret',
          allowedModels: ['gpt-4o'],
          defaultModel: 'gpt-4o',
          enabled: true,
        }),
      ],
    });

    const teacher = await createAuthedPage(browser, teacherSession.token);
    teacherContext = teacher.context;
    await openStudioSettings(teacher.page);
    await teacher.page.getByTestId('provider-item-openai').click();
    await expect(teacher.page.getByTestId('provider-base-url-openai')).toBeDisabled();

    const overrideResponse = await teacher.page.request.put(`${APP_BASE_URL}/api/me/ai/overrides`, {
      data: {
        overrides: [
          {
            family: 'llm',
            providerId: 'openai',
            enabled: true,
            baseUrl: 'http://127.0.0.1:4010/v1',
          },
        ],
      },
    });
    const overrideBody = (await overrideResponse.json()) as {
      success: boolean;
      errorCode?: string;
    };

    expect(overrideResponse.status()).toBe(400);
    expect(overrideBody.success).toBe(false);
    expect(overrideBody.errorCode).toBe('INVALID_REQUEST');

    const store = await readPlatformStore();
    expect(
      store.auditLogs.some((entry) => entry.action === 'user_provider_override.denied'),
    ).toBeTruthy();
  } finally {
    await teacherContext?.close();
  }
});

test('org-approved custom provider is selectable', async ({ browser }) => {
  let teacherContext: BrowserContext | undefined;

  try {
    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-custom',
      email: 'teacher-custom@example.com',
      displayName: 'Teacher Custom',
      organizationId: 'org-governed',
      organizationName: 'Governed Academy',
      organizationSlug: 'governed-academy',
    });

    await writePlatformStore({
      sessions: [teacherSession],
      organizationAiPolicies: [
        createOrganizationPolicy({
          organizationId: 'org-governed',
        }),
      ],
      organizationProviderConfigs: [
        createOrganizationProviderConfig({
          organizationId: 'org-governed',
          family: 'llm',
          providerId: 'custom-org-1',
          enabled: true,
          baseUrl: 'http://127.0.0.1:4020/v1',
          allowedModels: ['custom-chat-1'],
          defaultModel: 'custom-chat-1',
          providerDefinition: {
            name: 'Acme Gateway',
            providerType: 'openai',
            defaultBaseUrl: 'http://127.0.0.1:4020/v1',
            requiresApiKey: false,
            models: [{ id: 'custom-chat-1', name: 'Custom Chat 1' }],
          },
        }),
      ],
    });

    const teacher = await createAuthedPage(browser, teacherSession.token);
    teacherContext = teacher.context;
    await openStudioSettings(teacher.page);
    const customProvider = teacher.page.getByTestId('provider-item-custom-org-1');
    await expect(customProvider).toBeVisible();
    await customProvider.click();
    await expect(teacher.page.getByTestId('provider-api-key-custom-org-1')).toBeVisible();
  } finally {
    await teacherContext?.close();
  }
});

test('legacy local key still works only when no server-backed config exists, with a warning', async ({
  browser,
}) => {
  const mockServer = await startMockOpenAIServer();
  let teacherContext: BrowserContext | undefined;

  try {
    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-legacy',
      email: 'teacher-legacy@example.com',
      displayName: 'Teacher Legacy',
      organizationId: 'org-governed',
      organizationName: 'Governed Academy',
      organizationSlug: 'governed-academy',
    });

    await writePlatformStore({
      sessions: [teacherSession],
    });

    const teacher = await createAuthedPage(browser, teacherSession.token);
    teacherContext = teacher.context;
    await openStudioSettings(teacher.page);
    await teacher.page.getByTestId('provider-item-openai').click();
    await teacher.page.getByTestId('provider-api-key-openai').fill('legacy-secret');
    await teacher.page.getByTestId('provider-base-url-openai').fill(mockServer.baseUrl);
    await expect(teacher.page.getByTestId('legacy-fallback-notice')).toBeVisible();

    const verifyResponsePromise = teacher.page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/verify-model') && response.request().method() === 'POST',
    );
    await teacher.page.getByTestId('provider-test-openai').click();
    const verifyResponse = await verifyResponsePromise;
    const verifyBody = (await verifyResponse.json()) as { success: boolean };

    expect(verifyResponse.ok()).toBeTruthy();
    expect(verifyBody.success).toBe(true);
    await expect.poll(() => mockServer.hits.length).toBeGreaterThan(0);
    expect(mockServer.hits.at(-1)?.authorization).toBe('Bearer legacy-secret');

    const store = await readPlatformStore();
    expect(
      store.auditLogs.some((entry) => entry.action === 'provider_resolution.legacy_fallback_used'),
    ).toBeTruthy();
  } finally {
    await teacherContext?.close();
    await mockServer.close();
  }
});

test('async classroom generation resolves via org config without browser-sent secrets', async ({
  browser,
}) => {
  const browserHeaderMock = await startMockOpenAIServer();
  let teacherContext: BrowserContext | undefined;

  try {
    const teacherSession = createAuthSession({
      role: 'teacher',
      userId: 'teacher-background',
      email: 'teacher-background@example.com',
      displayName: 'Teacher Background',
      organizationId: 'org-governed',
      organizationName: 'Governed Academy',
      organizationSlug: 'governed-academy',
    });

    await writePlatformStore({
      sessions: [teacherSession],
      organizationAiPolicies: [
        createOrganizationPolicy({
          organizationId: 'org-governed',
        }),
      ],
      organizationProviderConfigs: [
        createOrganizationProviderConfig({
          organizationId: 'org-governed',
          family: 'llm',
          providerId: 'openai',
          secret: 'org-secret',
          baseUrl: 'http://127.0.0.1:9/v1',
          allowedModels: ['gpt-4o'],
          defaultModel: 'gpt-4o',
          enabled: true,
        }),
      ],
    });

    const teacher = await createAuthedPage(browser, teacherSession.token);
    teacherContext = teacher.context;

    const createResponse = await teacher.page.request.post(
      `${APP_BASE_URL}/api/generate-classroom`,
      {
        headers: {
          'x-api-key': 'browser-secret',
          'x-base-url': browserHeaderMock.baseUrl,
        },
        data: {
          requirement: 'Create a short algebra lesson with two scenes.',
        },
      },
    );
    const createBody = (await createResponse.json()) as {
      success: boolean;
      jobId: string;
    };

    expect(createResponse.status()).toBe(202);
    expect(createBody.success).toBe(true);

    const job = await waitForJobToFinish(teacher.page.request, createBody.jobId, 60);
    expect(job.done).toBe(true);
    expect(job.status).toBe('failed');
    expect(browserHeaderMock.hits).toHaveLength(0);
  } finally {
    await teacherContext?.close();
    await browserHeaderMock.close();
  }
});

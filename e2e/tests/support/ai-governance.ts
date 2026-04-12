import { createCipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import path from 'path';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import type {
  AuditLogRecord,
  JoinTokenRecord,
  MembershipRecord,
  OrganizationAIPolicyRecord,
  OrganizationKind,
  OrganizationProviderConfigRecord,
  OrganizationRecord,
  PlatformRole,
  PlatformStore,
  SessionRecord,
  UserProviderOverrideRecord,
  UserRecord,
} from '../../../lib/db/schema';
import type { SharedSimulation } from '../../../lib/types/stage';

export const APP_BASE_URL = 'http://localhost:3002';

const DATA_DIR = path.join(process.cwd(), 'data');
const PLATFORM_STORE_PATH = path.join(DATA_DIR, 'platform', 'platform-store.json');
const CLASSROOMS_DIR = path.join(DATA_DIR, 'classrooms');
const CLASSROOM_JOBS_DIR = path.join(DATA_DIR, 'classroom-jobs');
const ENCRYPTION_VERSION = 'v1';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const EMPTY_PLATFORM_STORE: PlatformStore = {
  users: [],
  organizations: [],
  memberships: [],
  sessions: [],
  joinTokens: [],
  auditLogs: [],
  organizationAiPolicies: [],
  organizationProviderConfigs: [],
  userProviderOverrides: [],
};
const TEST_SLIDE_THEME = {
  backgroundColor: '#ffffff',
  themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4'],
  fontColor: '#333333',
  fontName: 'Inter',
};

export interface SeededAuthSession {
  token: string;
  user: UserRecord;
  organization: OrganizationRecord;
  membership: MembershipRecord;
  session: SessionRecord;
}

export interface MockOpenAIHit {
  method: string;
  path: string;
  authorization: string | undefined;
  body: string;
}

export interface MockMiroFishHit {
  method: string;
  path: string;
  search: string;
}

function decodeConfiguredKey(rawKey: string): Buffer {
  const trimmed = rawKey.trim();

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  try {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Fall through to passphrase hashing.
  }

  return createHash('sha256').update(trimmed, 'utf8').digest();
}

function getEncryptionKey() {
  const configured = process.env.RAIC_SECRET_ENCRYPTION_KEY;
  if (!configured?.trim()) {
    throw new Error('RAIC_SECRET_ENCRYPTION_KEY must be set for Playwright governance tests.');
  }

  return decodeConfiguredKey(configured);
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function futureIso(days = 30) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function encryptSecret(secret: string) {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function createAuthSession(params: {
  role: PlatformRole;
  userId: string;
  email: string;
  displayName: string;
  organizationId?: string;
  organizationName?: string;
  organizationSlug?: string;
  organizationKind?: OrganizationKind;
}): SeededAuthSession {
  const issuedAt = nowIso();
  const organizationId = params.organizationId ?? 'org-1';
  const organizationName = params.organizationName ?? 'Governed School';
  const organizationSlug =
    params.organizationSlug ??
    organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const token = `${params.userId}-session-token`;

  const user: UserRecord = {
    id: params.userId,
    googleSub: `google-${params.userId}`,
    email: params.email,
    displayName: params.displayName,
    avatarUrl: null,
    createdAt: issuedAt,
    updatedAt: issuedAt,
    lastLoginAt: issuedAt,
  };

  const organization: OrganizationRecord = {
    id: organizationId,
    name: organizationName,
    slug: organizationSlug,
    kind: params.organizationKind ?? 'school',
    domainAllowlist: [],
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };

  const membership: MembershipRecord = {
    id: `membership-${params.userId}-${organizationId}`,
    organizationId,
    userId: params.userId,
    role: params.role,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };

  const session: SessionRecord = {
    id: `session-${params.userId}`,
    userId: params.userId,
    organizationId,
    classroomId: null,
    role: params.role,
    kind: 'web',
    tokenHash: hashToken(token),
    userAgent: 'Playwright',
    ipAddress: '127.0.0.1',
    createdAt: issuedAt,
    updatedAt: issuedAt,
    lastSeenAt: issuedAt,
    expiresAt: futureIso(1),
    absoluteExpiresAt: futureIso(30),
    revokedAt: null,
  };

  return {
    token,
    user,
    organization,
    membership,
    session,
  };
}

export function createOrganizationPolicy(params: {
  organizationId: string;
  allowPersonalOverrides?: boolean;
  allowPersonalCustomBaseUrls?: boolean;
}): OrganizationAIPolicyRecord {
  const timestamp = nowIso();
  return {
    id: randomUUID(),
    organizationId: params.organizationId,
    allowPersonalOverrides: params.allowPersonalOverrides ?? false,
    allowPersonalCustomBaseUrls: params.allowPersonalCustomBaseUrls ?? false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createOrganizationProviderConfig(params: {
  organizationId: string;
  family: OrganizationProviderConfigRecord['family'];
  providerId: string;
  enabled?: boolean;
  secret?: string | null;
  baseUrl?: string | null;
  allowedModels?: string[];
  defaultModel?: string | null;
  providerDefinition?: OrganizationProviderConfigRecord['providerDefinition'];
}): OrganizationProviderConfigRecord {
  const timestamp = nowIso();
  return {
    id: randomUUID(),
    organizationId: params.organizationId,
    family: params.family,
    providerId: params.providerId,
    providerDefinition: params.providerDefinition ?? null,
    encryptedSecret: params.secret ? encryptSecret(params.secret) : null,
    baseUrl: params.baseUrl ?? null,
    allowedModels: [...(params.allowedModels ?? [])],
    defaultModel: params.defaultModel ?? null,
    enabled: params.enabled ?? true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createUserProviderOverride(params: {
  organizationId: string;
  userId: string;
  family: UserProviderOverrideRecord['family'];
  providerId: string;
  enabled?: boolean;
  secret?: string | null;
  baseUrl?: string | null;
  preferredModel?: string | null;
}): UserProviderOverrideRecord {
  const timestamp = nowIso();
  return {
    id: randomUUID(),
    organizationId: params.organizationId,
    userId: params.userId,
    family: params.family,
    providerId: params.providerId,
    encryptedSecret: params.secret ? encryptSecret(params.secret) : null,
    baseUrl: params.baseUrl ?? null,
    preferredModel: params.preferredModel ?? null,
    enabled: params.enabled ?? true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createJoinToken(params: {
  classroomId: string;
  createdByUserId: string;
  organizationId?: string | null;
  displayName: string;
  rawToken: string;
  expiresAt?: string;
}) {
  const createdAt = nowIso();
  const expiresAt = params.expiresAt ?? futureIso(1);

  return {
    rawToken: params.rawToken,
    record: {
      id: randomUUID(),
      classroomId: params.classroomId,
      createdByUserId: params.createdByUserId,
      organizationId: params.organizationId ?? null,
      displayName: params.displayName,
      tokenHash: hashToken(params.rawToken),
      createdAt,
      expiresAt,
      consumedAt: null,
    } satisfies JoinTokenRecord,
  };
}

export async function resetRaicData() {
  await Promise.all([
    fs.rm(path.dirname(PLATFORM_STORE_PATH), { recursive: true, force: true }),
    fs.rm(CLASSROOMS_DIR, { recursive: true, force: true }),
    fs.rm(CLASSROOM_JOBS_DIR, { recursive: true, force: true }),
  ]);
}

export async function writePlatformStore(params: {
  sessions: SeededAuthSession[];
  joinTokens?: JoinTokenRecord[];
  organizationAiPolicies?: OrganizationAIPolicyRecord[];
  organizationProviderConfigs?: OrganizationProviderConfigRecord[];
  userProviderOverrides?: UserProviderOverrideRecord[];
  auditLogs?: AuditLogRecord[];
}) {
  const organizations = new Map<string, OrganizationRecord>();
  const users = new Map<string, UserRecord>();
  const memberships = new Map<string, MembershipRecord>();
  const sessions = new Map<string, SessionRecord>();

  for (const seeded of params.sessions) {
    organizations.set(seeded.organization.id, seeded.organization);
    users.set(seeded.user.id, seeded.user);
    memberships.set(seeded.membership.id, seeded.membership);
    sessions.set(seeded.session.id, seeded.session);
  }

  const store: PlatformStore = {
    users: [...users.values()],
    organizations: [...organizations.values()],
    memberships: [...memberships.values()],
    sessions: [...sessions.values()],
    joinTokens: [...(params.joinTokens ?? [])],
    auditLogs: [...(params.auditLogs ?? [])],
    organizationAiPolicies: [...(params.organizationAiPolicies ?? [])],
    organizationProviderConfigs: [...(params.organizationProviderConfigs ?? [])],
    userProviderOverrides: [...(params.userProviderOverrides ?? [])],
  };

  await fs.mkdir(path.dirname(PLATFORM_STORE_PATH), { recursive: true });
  await fs.writeFile(PLATFORM_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

export async function readPlatformStore(): Promise<PlatformStore> {
  try {
    const content = await fs.readFile(PLATFORM_STORE_PATH, 'utf8');
    return JSON.parse(content) as PlatformStore;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return structuredClone(EMPTY_PLATFORM_STORE);
    }
    throw error;
  }
}

export async function writeClassroomData(params: {
  classroomId: string;
  ownerUserId: string | null;
  organizationId?: string | null;
  stageName: string;
  sceneTitles: string[];
  sharedSimulation?: SharedSimulation | null;
}) {
  const createdAtIso = nowIso();
  const createdAtMs = Date.now();
  const stage = {
    id: params.classroomId,
    name: params.stageName,
    description: `${params.stageName} classroom`,
    createdAt: createdAtMs,
    updatedAt: createdAtMs,
    language: 'en-US',
    style: 'professional',
    sharedSimulation: params.sharedSimulation ?? undefined,
  };
  const scenes = params.sceneTitles.map((title, index) => ({
    id: `${params.classroomId}-scene-${index + 1}`,
    stageId: params.classroomId,
    type: 'slide' as const,
    title,
    order: index,
    content: {
      type: 'slide' as const,
      canvas: {
        id: `${params.classroomId}-slide-${index + 1}`,
        viewportSize: 1000,
        viewportRatio: 0.5625,
        theme: TEST_SLIDE_THEME,
        elements: [
          {
            type: 'text',
            id: `${params.classroomId}-title-${index + 1}`,
            content: title,
            left: 50,
            top: 50,
            width: 900,
            height: 100,
          },
        ],
      },
    },
    createdAt: createdAtMs,
    updatedAt: createdAtMs,
  }));

  const classroom = {
    id: params.classroomId,
    ownerUserId: params.ownerUserId,
    organizationId: params.organizationId ?? null,
    stage,
    scenes,
    createdAt: createdAtIso,
  };

  await fs.mkdir(CLASSROOMS_DIR, { recursive: true });
  await fs.writeFile(
    path.join(CLASSROOMS_DIR, `${params.classroomId}.json`),
    JSON.stringify(classroom, null, 2),
    'utf8',
  );

  return classroom;
}

export async function writeClassroomData(params: {
  classroomId: string;
  ownerUserId: string | null;
  organizationId?: string | null;
  stageName: string;
  sceneTitles: string[];
}) {
  const createdAtIso = nowIso();
  const createdAtMs = Date.now();
  const stage = {
    id: params.classroomId,
    name: params.stageName,
    description: `${params.stageName} classroom`,
    createdAt: createdAtMs,
    updatedAt: createdAtMs,
    language: 'en-US',
    style: 'professional',
  };
  const scenes = params.sceneTitles.map((title, index) => ({
    id: `${params.classroomId}-scene-${index + 1}`,
    stageId: params.classroomId,
    type: 'slide' as const,
    title,
    order: index,
    content: {
      type: 'slide' as const,
      canvas: {
        id: `${params.classroomId}-slide-${index + 1}`,
        viewportSize: 1000,
        viewportRatio: 0.5625,
        theme: TEST_SLIDE_THEME,
        elements: [
          {
            type: 'text',
            id: `${params.classroomId}-title-${index + 1}`,
            content: title,
            left: 50,
            top: 50,
            width: 900,
            height: 100,
          },
        ],
      },
    },
    createdAt: createdAtMs,
    updatedAt: createdAtMs,
  }));

  const classroom = {
    id: params.classroomId,
    ownerUserId: params.ownerUserId,
    organizationId: params.organizationId ?? null,
    stage,
    scenes,
    createdAt: createdAtIso,
  };

  await fs.mkdir(CLASSROOMS_DIR, { recursive: true });
  await fs.writeFile(
    path.join(CLASSROOMS_DIR, `${params.classroomId}.json`),
    JSON.stringify(classroom, null, 2),
    'utf8',
  );

  return classroom;
}

export async function addSessionCookie(context: BrowserContext, token: string) {
  await context.addCookies([
    {
      name: 'raic_session',
      value: token,
      url: APP_BASE_URL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

async function readRequestBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeOpenAIResponse(res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'OK',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 4,
        completion_tokens: 1,
        total_tokens: 5,
      },
    }),
  );
}

export async function startMockOpenAIServer() {
  const hits: MockOpenAIHit[] = [];

  const server = createServer(async (req, res) => {
    const body = await readRequestBody(req);
    hits.push({
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      authorization:
        typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      body,
    });

    writeOpenAIResponse(res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start mock OpenAI server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    hits,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildMockMiroFishPage(params: {
  kind: 'simulation' | 'report';
  resourceId: string;
  query: URLSearchParams;
}) {
  const queryState = {
    embed: params.query.get('embed') ?? '',
    classroomToken: params.query.get('classroomToken') ?? '',
    participantToken: params.query.get('participantToken') ?? '',
    mirofishSessionId: params.query.get('mirofishSessionId') ?? '',
  };
  const queryJson = JSON.stringify(queryState);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mock MiroFish ${escapeHtml(params.kind)}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(96, 165, 250, 0.3), transparent 35%),
          radial-gradient(circle at bottom right, rgba(244, 114, 182, 0.22), transparent 40%),
          #020617;
        color: #e2e8f0;
      }
      main {
        padding: 24px;
      }
      .shell {
        max-width: 960px;
        margin: 0 auto;
        display: grid;
        gap: 18px;
      }
      .panel {
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 18px;
        padding: 18px;
        background: rgba(15, 23, 42, 0.82);
        box-shadow: 0 18px 40px rgba(2, 6, 23, 0.35);
      }
      .eyebrow {
        margin: 0 0 8px;
        font-size: 12px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: #93c5fd;
      }
      h1 {
        margin: 0;
        font-size: 28px;
      }
      p {
        margin: 8px 0 0;
        color: #cbd5e1;
      }
      .grid {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      }
      button {
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 999px;
        padding: 10px 14px;
        background: rgba(30, 41, 59, 0.92);
        color: #f8fafc;
        font: inherit;
        cursor: pointer;
      }
      button:hover {
        border-color: rgba(125, 211, 252, 0.7);
        background: rgba(37, 99, 235, 0.34);
      }
      code,
      pre {
        font-family: "Consolas", "SFMono-Regular", monospace;
      }
      pre {
        margin: 0;
        padding: 12px;
        overflow: auto;
        border-radius: 14px;
        background: rgba(2, 6, 23, 0.88);
        color: #bfdbfe;
      }
      [data-standalone-chrome] {
        display: ${queryState.embed === '1' ? 'none' : 'block'};
      }
    </style>
  </head>
  <body>
    <main>
      <div class="shell">
        <section class="panel">
          <div class="eyebrow">Mock MiroFish ${escapeHtml(params.kind)}</div>
          <h1>${escapeHtml(params.kind === 'simulation' ? 'Simulation' : 'Report')}: ${escapeHtml(params.resourceId)}</h1>
          <p data-testid="mirofish-mode">Embed mode: ${escapeHtml(queryState.embed === '1' ? 'enabled' : 'disabled')}</p>
          <p data-standalone-chrome>Standalone wrapper chrome stays visible when embed mode is off.</p>
        </section>

        <section class="panel">
          <div class="eyebrow">Wrapper Payload</div>
          <pre data-testid="mirofish-query-state">${escapeHtml(queryJson)}</pre>
        </section>

        <section class="panel">
          <div class="eyebrow">Host Events</div>
          <div class="grid">
            <button type="button" data-testid="emit-ready" data-payload='{"type":"ready"}'>Send ready</button>
            <button type="button" data-testid="emit-running" data-payload='{"type":"runStatus","status":"running"}'>Run running</button>
            <button type="button" data-testid="emit-completed" data-payload='{"type":"runStatus","status":"completed"}'>Run completed</button>
            <button type="button" data-testid="emit-report-ready" data-payload='{"type":"reportReady"}'>Report ready</button>
            <button type="button" data-testid="emit-presence-two" data-payload='{"type":"presenceSummary","participantCount":2}'>Presence 2</button>
            <button type="button" data-testid="emit-presence-three" data-payload='{"type":"presenceSummary","participantCount":3}'>Presence 3</button>
            <button type="button" data-testid="emit-session-live" data-payload='{"type":"sessionStatus","status":"live","message":"Collaboration is live"}'>Session live</button>
            <button type="button" data-testid="emit-session-frozen" data-payload='{"type":"sessionStatus","status":"frozen","message":"Collaboration is frozen"}'>Session frozen</button>
            <button type="button" data-testid="emit-session-closed" data-payload='{"type":"sessionStatus","status":"closed","message":"Collaboration is closed"}'>Session closed</button>
            <button type="button" data-testid="emit-error" data-payload='{"type":"error","message":"Mock MiroFish forced an embed failure."}'>Trigger error</button>
          </div>
        </section>
      </div>
    </main>
    <script>
      (() => {
        const queryState = ${queryJson};
        const pageKind = ${JSON.stringify(params.kind)};

        function post(payload) {
          window.parent.postMessage(payload, '*');
        }

        function emitInitialEvents() {
          if (queryState.embed !== '1') {
            return;
          }

          if (pageKind === 'report') {
            post({ type: 'reportReady' });
            return;
          }

          post({ type: 'ready' });
          post({ type: 'runStatus', status: 'running' });
        }

        window.addEventListener('load', () => {
          emitInitialEvents();
        });

        document.querySelectorAll('[data-payload]').forEach((button) => {
          button.addEventListener('click', () => {
            const payload = button.getAttribute('data-payload');
            if (!payload) {
              return;
            }

            post(JSON.parse(payload));
          });
        });
      })();
    </script>
  </body>
</html>`;
}

export async function startMockMiroFishServer(params?: { port?: number }) {
  const hits: MockMiroFishHit[] = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    hits.push({
      method: req.method ?? 'GET',
      path: url.pathname,
      search: url.search,
    });

    const simulationMatch = url.pathname.match(/^\/simulation\/([^/]+)\/start$/);
    if (req.method === 'GET' && simulationMatch) {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        buildMockMiroFishPage({
          kind: 'simulation',
          resourceId: decodeURIComponent(simulationMatch[1] ?? ''),
          query: url.searchParams,
        }),
      );
      return;
    }

    const reportMatch = url.pathname.match(/^\/report\/([^/]+)$/);
    if (req.method === 'GET' && reportMatch) {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        buildMockMiroFishPage({
          kind: 'report',
          resourceId: decodeURIComponent(reportMatch[1] ?? ''),
          query: url.searchParams,
        }),
      );
      return;
    }

    const apiSimulationMatch = url.pathname.match(/^\/api\/simulation\/([^/]+)$/);
    if (req.method === 'GET' && apiSimulationMatch) {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          success: true,
          simulationId: decodeURIComponent(apiSimulationMatch[1] ?? ''),
        }),
      );
      return;
    }

    const apiReportMatch = url.pathname.match(/^\/api\/report\/([^/]+)$/);
    if (req.method === 'GET' && apiReportMatch) {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          success: true,
          reportId: decodeURIComponent(apiReportMatch[1] ?? ''),
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Not found');
  });

  await new Promise<void>((resolve) => {
    server.listen(params?.port ?? 0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start mock MiroFish server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    hits,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

export async function waitForJobToFinish(
  request: APIRequestContext,
  jobId: string,
  maxAttempts = 20,
) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await request.get(`/api/generate-classroom/${jobId}`);
    const body = (await response.json()) as {
      success: boolean;
      status?: string;
      done?: boolean;
      error?: string;
    };

    if (body.done) {
      return body;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for classroom job ${jobId} to finish.`);
}

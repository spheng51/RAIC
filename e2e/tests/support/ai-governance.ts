import { createCipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import path from 'path';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import type {
  AuditLogRecord,
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

export const APP_BASE_URL = 'http://localhost:3002';

const DATA_DIR = path.join(process.cwd(), 'data');
const PLATFORM_STORE_PATH = path.join(DATA_DIR, 'platform', 'platform-store.json');
const CLASSROOMS_DIR = path.join(DATA_DIR, 'classrooms');
const CLASSROOM_JOBS_DIR = path.join(DATA_DIR, 'classroom-jobs');
const ENCRYPTION_VERSION = 'v1';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

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
    organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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

export async function resetRaicData() {
  await Promise.all([
    fs.rm(path.dirname(PLATFORM_STORE_PATH), { recursive: true, force: true }),
    fs.rm(CLASSROOMS_DIR, { recursive: true, force: true }),
    fs.rm(CLASSROOM_JOBS_DIR, { recursive: true, force: true }),
  ]);
}

export async function writePlatformStore(params: {
  sessions: SeededAuthSession[];
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
    joinTokens: [],
    auditLogs: [...(params.auditLogs ?? [])],
    organizationAiPolicies: [...(params.organizationAiPolicies ?? [])],
    organizationProviderConfigs: [...(params.organizationProviderConfigs ?? [])],
    userProviderOverrides: [...(params.userProviderOverrides ?? [])],
  };

  await fs.mkdir(path.dirname(PLATFORM_STORE_PATH), { recursive: true });
  await fs.writeFile(PLATFORM_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

export async function readPlatformStore(): Promise<PlatformStore> {
  const content = await fs.readFile(PLATFORM_STORE_PATH, 'utf8');
  return JSON.parse(content) as PlatformStore;
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
      authorization: typeof req.headers.authorization === 'string'
        ? req.headers.authorization
        : undefined,
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

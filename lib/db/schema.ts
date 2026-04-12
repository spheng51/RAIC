import 'server-only';

import type { AIProviderDefinition, AIProviderFamily } from '@/lib/types/ai-governance';

export type PlatformRole = 'teacher' | 'student' | 'org_admin' | 'system_admin';
export type OrganizationKind = 'personal' | 'school';
export type SessionKind = 'web' | 'classroom';

export interface UserRecord {
  id: string;
  googleSub: string | null;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  kind: OrganizationKind;
  domainAllowlist: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MembershipRecord {
  id: string;
  organizationId: string;
  userId: string;
  role: PlatformRole;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  organizationId: string | null;
  classroomId: string | null;
  role: PlatformRole;
  kind: SessionKind;
  tokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
}

export interface JoinTokenRecord {
  id: string;
  classroomId: string;
  createdByUserId: string;
  organizationId: string | null;
  displayName: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface AuditLogRecord {
  id: string;
  organizationId: string | null;
  userId: string | null;
  actorRole: PlatformRole | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface OrganizationAIPolicyRecord {
  id: string;
  organizationId: string;
  allowPersonalOverrides: boolean;
  allowPersonalCustomBaseUrls: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationProviderConfigRecord {
  id: string;
  organizationId: string;
  family: AIProviderFamily;
  providerId: string;
  providerDefinition: AIProviderDefinition | null;
  encryptedSecret: string | null;
  baseUrl: string | null;
  allowedModels: string[];
  defaultModel: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserProviderOverrideRecord {
  id: string;
  organizationId: string;
  userId: string;
  family: AIProviderFamily;
  providerId: string;
  encryptedSecret: string | null;
  baseUrl: string | null;
  preferredModel: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformStore {
  users: UserRecord[];
  organizations: OrganizationRecord[];
  memberships: MembershipRecord[];
  sessions: SessionRecord[];
  joinTokens: JoinTokenRecord[];
  auditLogs: AuditLogRecord[];
  organizationAiPolicies: OrganizationAIPolicyRecord[];
  organizationProviderConfigs: OrganizationProviderConfigRecord[];
  userProviderOverrides: UserProviderOverrideRecord[];
}

export const EMPTY_PLATFORM_STORE: PlatformStore = {
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

export const PLATFORM_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    google_sub TEXT UNIQUE,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    last_login_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    domain_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (organization_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    classroom_id TEXT,
    role TEXT NOT NULL,
    kind TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    user_agent TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    absolute_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
  )`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS classroom_id TEXT`,
  `CREATE TABLE IF NOT EXISTS join_tokens (
    id TEXT PRIMARY KEY,
    classroom_id TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    display_name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    actor_role TEXT,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS organization_ai_policies (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    allow_personal_overrides BOOLEAN NOT NULL DEFAULT FALSE,
    allow_personal_custom_base_urls BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (organization_id)
  )`,
  `CREATE TABLE IF NOT EXISTS organization_provider_configs (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    family TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    provider_definition JSONB,
    encrypted_secret TEXT,
    base_url TEXT,
    allowed_models JSONB NOT NULL DEFAULT '[]'::jsonb,
    default_model TEXT,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (organization_id, family, provider_id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_provider_overrides (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    encrypted_secret TEXT,
    base_url TEXT,
    preferred_model TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (organization_id, user_id, family, provider_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_classroom_id ON sessions (classroom_id)`,
  `CREATE INDEX IF NOT EXISTS idx_join_tokens_token_hash ON join_tokens (token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_org_provider_configs_org_family ON organization_provider_configs (organization_id, family)`,
  `CREATE INDEX IF NOT EXISTS idx_user_provider_overrides_org_user_family ON user_provider_overrides (organization_id, user_id, family)`,
];

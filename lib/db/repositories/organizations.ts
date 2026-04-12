import 'server-only';

import { randomUUID } from 'crypto';
import { readPlatformStore, runPostgresQuery, updatePlatformStore } from '@/lib/db/client';
import type { OrganizationKind, OrganizationRecord, UserRecord } from '@/lib/db/schema';

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  kind: OrganizationKind;
  domain_allowlist: string[] | string | null;
  created_at: string;
  updated_at: string;
}

function mapOrganizationRow(row: OrganizationRow): OrganizationRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    domainAllowlist:
      typeof row.domain_allowlist === 'string'
        ? JSON.parse(row.domain_allowlist)
        : row.domain_allowlist ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export async function findOrganizationById(organizationId: string): Promise<OrganizationRecord | null> {
  const rows = await runPostgresQuery<OrganizationRow>(
    `SELECT id, name, slug, kind, domain_allowlist, created_at, updated_at
     FROM organizations
     WHERE id = $1
     LIMIT 1`,
    [organizationId],
  );

  if (rows) {
    return rows[0] ? mapOrganizationRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  return store.organizations.find((org) => org.id === organizationId) ?? null;
}

export async function findOrganizationBySlug(slug: string): Promise<OrganizationRecord | null> {
  const rows = await runPostgresQuery<OrganizationRow>(
    `SELECT id, name, slug, kind, domain_allowlist, created_at, updated_at
     FROM organizations
     WHERE slug = $1
     LIMIT 1`,
    [slug],
  );

  if (rows) {
    return rows[0] ? mapOrganizationRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  return store.organizations.find((org) => org.slug === slug) ?? null;
}

export async function findOrCreatePersonalOrganization(user: UserRecord): Promise<OrganizationRecord> {
  const preferredSlug = slugify(
    `${user.email.split('@')[0] || user.displayName || 'workspace'}-${user.id.slice(0, 8)}`,
  );
  const existing = await findOrganizationBySlug(preferredSlug);
  if (existing) return existing;

  const now = new Date().toISOString();
  const name = `${user.displayName}'s workspace`;

  const rows = await runPostgresQuery<OrganizationRow>(
    `INSERT INTO organizations (id, name, slug, kind, domain_allowlist, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)
     ON CONFLICT (slug) DO UPDATE
     SET name = EXCLUDED.name,
         updated_at = EXCLUDED.updated_at
     RETURNING id, name, slug, kind, domain_allowlist, created_at, updated_at`,
    [randomUUID(), name, preferredSlug, 'personal', JSON.stringify([]), now],
  );

  if (rows) {
    return mapOrganizationRow(rows[0]);
  }

  return updatePlatformStore((store) => {
    const org = store.organizations.find((candidate) => candidate.slug === preferredSlug);
    if (org) return org;

    const created: OrganizationRecord = {
      id: randomUUID(),
      name,
      slug: preferredSlug,
      kind: 'personal',
      domainAllowlist: [],
      createdAt: now,
      updatedAt: now,
    };
    store.organizations.push(created);
    return created;
  });
}

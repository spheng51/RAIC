import 'server-only';

import { randomUUID } from 'crypto';
import { readPlatformStore, runPostgresQuery, updatePlatformStore } from '@/lib/db/client';
import type { UserRecord } from '@/lib/db/schema';

interface UpsertGoogleUserInput {
  googleSub: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface CreateClassroomGuestUserInput {
  displayName: string;
  emailHint: string;
}

interface UserRow {
  id: string;
  google_sub: string | null;
  email: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

function mapUserRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export async function findUserById(userId: string): Promise<UserRecord | null> {
  const rows = await runPostgresQuery<UserRow>(
    `SELECT id, google_sub, email, display_name, avatar_url, created_at, updated_at, last_login_at
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId],
  );

  if (rows) {
    return rows[0] ? mapUserRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  return store.users.find((user) => user.id === userId) ?? null;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const rows = await runPostgresQuery<UserRow>(
    `SELECT id, google_sub, email, display_name, avatar_url, created_at, updated_at, last_login_at
     FROM users
     WHERE lower(email) = $1
     LIMIT 1`,
    [normalizedEmail],
  );

  if (rows) {
    return rows[0] ? mapUserRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  return store.users.find((user) => user.email.toLowerCase() === normalizedEmail) ?? null;
}

export async function findUserByGoogleSub(googleSub: string): Promise<UserRecord | null> {
  const rows = await runPostgresQuery<UserRow>(
    `SELECT id, google_sub, email, display_name, avatar_url, created_at, updated_at, last_login_at
     FROM users
     WHERE google_sub = $1
     LIMIT 1`,
    [googleSub],
  );

  if (rows) {
    return rows[0] ? mapUserRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  return store.users.find((user) => user.googleSub === googleSub) ?? null;
}

export async function upsertGoogleUser(input: UpsertGoogleUserInput): Promise<UserRecord> {
  const now = new Date().toISOString();
  const normalizedEmail = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim() || normalizedEmail;
  const avatarUrl = input.avatarUrl?.trim() || null;
  const existing = (await findUserByGoogleSub(input.googleSub)) ?? (await findUserByEmail(normalizedEmail));

  const rows = existing
    ? await runPostgresQuery<UserRow>(
        `UPDATE users
         SET google_sub = $2,
             email = $3,
             display_name = $4,
             avatar_url = $5,
             updated_at = $6,
             last_login_at = $6
         WHERE id = $1
         RETURNING id, google_sub, email, display_name, avatar_url, created_at, updated_at, last_login_at`,
        [existing.id, input.googleSub, normalizedEmail, displayName, avatarUrl, now],
      )
    : await runPostgresQuery<UserRow>(
        `INSERT INTO users (
            id,
            google_sub,
            email,
            display_name,
            avatar_url,
            created_at,
            updated_at,
            last_login_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $6, $6)
          RETURNING id, google_sub, email, display_name, avatar_url, created_at, updated_at, last_login_at`,
        [randomUUID(), input.googleSub, normalizedEmail, displayName, avatarUrl, now],
      );

  if (rows) {
    return mapUserRow(rows[0]);
  }

  return updatePlatformStore((store) => {
    const current =
      store.users.find((user) => user.googleSub === input.googleSub) ??
      store.users.find((user) => user.email.toLowerCase() === normalizedEmail);

    if (current) {
      current.googleSub = input.googleSub;
      current.email = normalizedEmail;
      current.displayName = displayName;
      current.avatarUrl = avatarUrl;
      current.updatedAt = now;
      current.lastLoginAt = now;
      return current;
    }

    const user: UserRecord = {
      id: randomUUID(),
      googleSub: input.googleSub,
      email: normalizedEmail,
      displayName,
      avatarUrl,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };
    store.users.push(user);
    return user;
  });
}

export async function createClassroomGuestUser(
  input: CreateClassroomGuestUserInput,
): Promise<UserRecord> {
  const now = new Date().toISOString();
  const displayName = input.displayName.trim() || 'Student';
  const normalizedHint = input.emailHint
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const email = `${normalizedHint || 'student'}-${randomUUID()}@classroom.raic.local`;

  const rows = await runPostgresQuery<UserRow>(
    `INSERT INTO users (
        id,
        google_sub,
        email,
        display_name,
        avatar_url,
        created_at,
        updated_at,
        last_login_at
      )
      VALUES ($1, NULL, $2, $3, NULL, $4, $4, NULL)
      RETURNING id, google_sub, email, display_name, avatar_url, created_at, updated_at, last_login_at`,
    [randomUUID(), email, displayName, now],
  );

  if (rows) {
    return mapUserRow(rows[0]);
  }

  return updatePlatformStore((store) => {
    const user: UserRecord = {
      id: randomUUID(),
      googleSub: null,
      email,
      displayName,
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    };
    store.users.push(user);
    return user;
  });
}

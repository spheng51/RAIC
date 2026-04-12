#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REQUIRED_AUDIT_ACTIONS = [
  'classroom.mirofish.attached',
  'classroom.mirofish.updated',
  'classroom.presentation.surface_changed',
  'classroom.presentation.recovered_to_lesson',
  'classroom.presentation_control.granted',
  'classroom.presentation_control.revoked',
];

function fail(message) {
  console.error(`\n[mirofish:audit] ${message}`);
  process.exit(1);
}

async function readPlatformStore(storePath) {
  try {
    const content = await fs.readFile(storePath, 'utf8');
    return JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      fail(
        `Platform store not found at ${storePath}. This verifier works with JSON persistence or an exported platform-store snapshot.`,
      );
    }
    fail(
      `Unable to read platform store at ${storePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function countActions(auditLogs) {
  const counts = new Map();

  for (const entry of auditLogs) {
    if (!entry || typeof entry.action !== 'string') {
      continue;
    }

    counts.set(entry.action, (counts.get(entry.action) ?? 0) + 1);
  }

  return counts;
}

async function main() {
  const storePath = path.resolve(
    process.cwd(),
    process.env.RAIC_PLATFORM_STORE_PATH?.trim() || 'data/platform/platform-store.json',
  );
  const store = await readPlatformStore(storePath);
  const auditLogs = Array.isArray(store?.auditLogs) ? store.auditLogs : [];

  if (auditLogs.length === 0) {
    fail(`No audit logs found in ${storePath}`);
  }

  const counts = countActions(auditLogs);
  const missing = REQUIRED_AUDIT_ACTIONS.filter((action) => !counts.has(action));

  console.log(`[mirofish:audit] Loaded ${auditLogs.length} audit log entries from ${storePath}`);

  for (const action of REQUIRED_AUDIT_ACTIONS) {
    console.log(`[mirofish:audit] ${action}: ${counts.get(action) ?? 0}`);
  }

  const collaborationActions = [...counts.entries()]
    .filter(([action]) => action.startsWith('classroom.mirofish.collaboration.'))
    .sort((left, right) => left[0].localeCompare(right[0]));

  if (collaborationActions.length > 0) {
    for (const [action, count] of collaborationActions) {
      console.log(`[mirofish:audit] ${action}: ${count}`);
    }
  } else {
    console.log('[mirofish:audit] No collaboration audit actions were found in this store');
  }

  if (missing.length > 0) {
    fail(`Missing required audit actions: ${missing.join(', ')}`);
  }

  console.log('[mirofish:audit] Audit verification passed');
}

await main();

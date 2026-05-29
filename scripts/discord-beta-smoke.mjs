#!/usr/bin/env node

import process from 'node:process';

const DEFAULT_BASE_URL = 'https://open-raic.com';

const baseUrl = normalizeBaseUrl(
  process.env.RAIC_DISCORD_SMOKE_BASE_URL ||
    process.env.RAIC_PRODUCTION_BASE_URL ||
    DEFAULT_BASE_URL,
);
const teacherCookie = process.env.RAIC_DISCORD_SMOKE_COOKIE || '';
const eventId = process.env.RAIC_DISCORD_SMOKE_EVENT_ID || '';
const connectionId = process.env.RAIC_DISCORD_SMOKE_CONNECTION_ID || '';
const channelId = process.env.RAIC_DISCORD_SMOKE_CHANNEL_ID || '';
const cronSecret = process.env.CRON_SECRET || process.env.RAIC_DISCORD_SMOKE_CRON_SECRET || '';
const allowBlockers = process.argv.includes('--allow-blockers');

const results = [];

function normalizeBaseUrl(rawValue) {
  const parsed = new URL(rawValue);
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

function record(status, label, detail) {
  results.push({ status, label, detail });
  const prefix = status.toUpperCase().padEnd(7);
  console.log(`[discord-beta-smoke] ${prefix} ${label}${detail ? ` - ${detail}` : ''}`);
}

function pass(label, detail) {
  record('pass', label, detail);
}

function fail(label, detail) {
  record('fail', label, detail);
}

function block(label, detail) {
  record('block', label, detail);
}

function manual(label, detail) {
  record('manual', label, detail);
}

async function fetchJson(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(teacherCookie ? { Cookie: teacherCookie } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body = null;

  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  return { response, body };
}

async function checkHealth() {
  const { response, body } = await fetchJson('/api/health');
  if (response.status === 200 && body?.success === true) {
    pass('/api/health', 'target is reachable');
  } else {
    fail('/api/health', `expected HTTP 200 success:true, got HTTP ${response.status}`);
  }
}

async function checkUnauthenticatedGuards() {
  const { response: connectionResponse, body: connectionBody } = await fetchJson(
    '/api/integrations/discord/connection',
    { headers: { Cookie: '' } },
  );
  if (connectionResponse.status === 401 && connectionBody?.errorCode === 'UNAUTHORIZED') {
    pass('/api/integrations/discord/connection unauth guard', 'teacher auth is required');
  } else {
    fail(
      '/api/integrations/discord/connection unauth guard',
      `expected HTTP 401 UNAUTHORIZED, got HTTP ${connectionResponse.status}`,
    );
  }

  const { response: syncResponse, body: syncBody } = await fetchJson(
    '/api/scheduled-classes/smoke-discord-event/discord-sync',
    { method: 'POST', headers: { Cookie: '' } },
  );
  if (syncResponse.status === 401 && syncBody?.errorCode === 'UNAUTHORIZED') {
    pass('/api/scheduled-classes/[id]/discord-sync unauth guard', 'teacher auth is required');
  } else {
    fail(
      '/api/scheduled-classes/[id]/discord-sync unauth guard',
      `expected HTTP 401 UNAUTHORIZED, got HTTP ${syncResponse.status}`,
    );
  }
}

async function checkConnectionSnapshot() {
  if (!teacherCookie) {
    block(
      'Discord connection snapshot',
      'set RAIC_DISCORD_SMOKE_COOKIE to a signed-in teacher session cookie',
    );
    return null;
  }

  const { response, body } = await fetchJson('/api/integrations/discord/connection');
  if (response.status !== 200 || body?.success !== true) {
    fail(
      '/api/integrations/discord/connection',
      `expected HTTP 200 success:true, got HTTP ${response.status}`,
    );
    return null;
  }

  if (body.configured !== true) {
    block(
      'Discord configuration',
      'DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, or bot token missing',
    );
  } else {
    pass('Discord configuration', 'server reports configured:true');
  }

  if (body.connection?.id) {
    pass('Discord connection', `${body.connection.guildName || 'guild'} connected`);
  } else {
    block('Discord connection', 'connect a disposable Discord test server from Studio');
  }

  if (body.connection?.channelId) {
    pass('Discord announcement channel', body.connection.channelName || body.connection.channelId);
  } else {
    block('Discord announcement channel', 'select and save a Discord announcement channel');
  }

  return body;
}

async function saveChannelIfRequested(snapshot) {
  if (!teacherCookie || !connectionId || !channelId) {
    manual(
      'Save Discord channel',
      'set RAIC_DISCORD_SMOKE_CONNECTION_ID and RAIC_DISCORD_SMOKE_CHANNEL_ID to automate channel save',
    );
    return snapshot;
  }

  const { response, body } = await fetchJson('/api/integrations/discord/connection', {
    method: 'POST',
    body: JSON.stringify({ connectionId, channelId }),
  });
  if (
    response.status === 200 &&
    body?.success === true &&
    body.connection?.channelId === channelId
  ) {
    pass('Save Discord channel', `saved channel ${channelId}`);
    return body;
  }

  fail('Save Discord channel', `expected saved channel ${channelId}, got HTTP ${response.status}`);
  return snapshot;
}

async function syncScheduledClassIfRequested() {
  if (!teacherCookie || !eventId) {
    manual(
      'Sync scheduled class',
      'set RAIC_DISCORD_SMOKE_EVENT_ID for a future teacher-owned class with a linked classroom',
    );
    return;
  }

  const { response, body } = await fetchJson(
    `/api/scheduled-classes/${encodeURIComponent(eventId)}/discord-sync`,
    { method: 'POST' },
  );
  const sync = body?.event?.discordSync;
  if (response.status === 200 && body?.success === true && sync?.enabled === true) {
    const detail = sync.scheduledEventUrl || sync.syncWarning || 'Discord sync metadata returned';
    pass('Sync scheduled class', detail);
    return;
  }

  fail('Sync scheduled class', `expected synced event, got HTTP ${response.status}`);
}

async function runReminderCron() {
  if (!cronSecret) {
    block('Discord reminder cron', 'set CRON_SECRET or RAIC_DISCORD_SMOKE_CRON_SECRET');
    return;
  }

  const { response, body } = await fetchJson('/api/cron/discord-scheduled-class-reminders', {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  if (
    response.status === 200 &&
    body?.success === true &&
    Number.isInteger(body.checked) &&
    Number.isInteger(body.sent) &&
    Number.isInteger(body.failed)
  ) {
    pass(
      'Discord reminder cron',
      `checked=${body.checked} sent=${body.sent} failed=${body.failed}`,
    );
    return;
  }

  fail('Discord reminder cron', `expected cron result counts, got HTTP ${response.status}`);
}

function printManualChecklist() {
  console.log('');
  console.log('[discord-beta-smoke] Manual Discord beta checklist');
  manual(
    'Discord app redirect URLs',
    'Confirm preview and production callback URLs are registered in the Discord developer app.',
  );
  manual(
    'Connect Discord test server',
    'Sign in as a teacher, connect a disposable Discord server, and verify Studio returns with ?discord=connected.',
  );
  manual(
    'Verify Discord scheduled event',
    'Create or choose a future scheduled class with a linked classroom, sync it, and inspect the Discord event name/time/location link.',
  );
  manual(
    'Verify update/delete behavior',
    'Edit and re-sync the class, then delete it and confirm the Discord scheduled event is removed or already gone.',
  );
  manual(
    'Verify reminder message',
    'Use a near-term class and cron invocation to confirm the configured channel receives exactly one reminder.',
  );
}

async function main() {
  console.log(`[discord-beta-smoke] Base URL: ${baseUrl}`);
  await checkHealth();
  await checkUnauthenticatedGuards();
  const snapshot = await checkConnectionSnapshot();
  await saveChannelIfRequested(snapshot);
  await syncScheduledClassIfRequested();
  await runReminderCron();
  printManualChecklist();

  const failures = results.filter((result) => result.status === 'fail');
  const blockers = results.filter((result) => result.status === 'block');
  const manualSteps = results.filter((result) => result.status === 'manual');

  console.log('');
  console.log(
    `[discord-beta-smoke] Summary: ${
      results.length - failures.length - blockers.length - manualSteps.length
    } automated passed, ${failures.length} failed, ${blockers.length} blocked, ${
      manualSteps.length
    } manual checks listed`,
  );

  if (failures.length > 0 || (blockers.length > 0 && !allowBlockers)) {
    process.exitCode = 1;
  }
}

await main();

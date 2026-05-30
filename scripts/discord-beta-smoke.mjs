#!/usr/bin/env node

import process from 'node:process';

const DEFAULT_BASE_URL = 'https://open-raic.com';
const wantsHelp = process.argv.includes('--help') || process.argv.includes('-h');
const allowBlockers = process.argv.includes('--allow-blockers');

if (wantsHelp) {
  printUsage();
  process.exit(0);
}

const results = [];
const rawBaseUrl =
  process.env.RAIC_DISCORD_SMOKE_BASE_URL ||
  process.env.RAIC_PRODUCTION_BASE_URL ||
  DEFAULT_BASE_URL;
const baseUrl = resolveBaseUrl(rawBaseUrl);
const teacherCookie = process.env.RAIC_DISCORD_SMOKE_COOKIE || '';
const eventId = process.env.RAIC_DISCORD_SMOKE_EVENT_ID || '';
const connectionId = process.env.RAIC_DISCORD_SMOKE_CONNECTION_ID || '';
const channelId = process.env.RAIC_DISCORD_SMOKE_CHANNEL_ID || '';
const cronSecretSource = process.env.RAIC_DISCORD_SMOKE_CRON_SECRET
  ? 'RAIC_DISCORD_SMOKE_CRON_SECRET'
  : process.env.CRON_SECRET
    ? 'CRON_SECRET'
    : '';
const cronSecret = (
  process.env.RAIC_DISCORD_SMOKE_CRON_SECRET ||
  process.env.CRON_SECRET ||
  ''
).trim();

function normalizeBaseUrl(rawValue) {
  const parsed = new URL(rawValue);
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

function resolveBaseUrl(rawValue) {
  try {
    return normalizeBaseUrl(rawValue);
  } catch (error) {
    fail(
      'Discord beta smoke base URL',
      `invalid RAIC_DISCORD_SMOKE_BASE_URL/RAIC_PRODUCTION_BASE_URL: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
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

function printUsage() {
  console.log(`Discord beta smoke gate

Usage:
  pnpm run smoke:discord-beta
  pnpm run smoke:discord-beta -- --allow-blockers

Environment:
  RAIC_DISCORD_SMOKE_BASE_URL       Preview or production base URL. Defaults to RAIC_PRODUCTION_BASE_URL, then https://open-raic.com.
  RAIC_DISCORD_SMOKE_COOKIE         Full Cookie header for a signed-in teacher session, for example "session=...".
  RAIC_DISCORD_SMOKE_CONNECTION_ID  Optional Discord connection id for automated channel save.
  RAIC_DISCORD_SMOKE_CHANNEL_ID     Optional Discord channel id for automated channel save.
  RAIC_DISCORD_SMOKE_EVENT_ID       Optional scheduled class id for automated Discord sync.
  RAIC_DISCORD_SMOKE_CRON_SECRET    Preferred cron bearer token for this smoke. Falls back to CRON_SECRET.

Exit behavior:
  Fails on automated failures or missing live-smoke prerequisites.
  Use --allow-blockers to record blocked live-smoke prerequisites without failing.`);
}

async function fetchJson(path, init = {}) {
  if (!baseUrl) {
    throw new Error('base URL is invalid');
  }

  let response;

  try {
    response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(teacherCookie ? { Cookie: teacherCookie } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    throw new Error(
      `request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

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

function describeApiResponse(response, body) {
  const contentType = response.headers.get('content-type') || 'unknown content-type';
  const parts = [`HTTP ${response.status}`, contentType];
  if (response.redirected) {
    parts.push(`redirected to ${response.url}`);
  }
  if (body?.errorCode) {
    parts.push(`errorCode=${body.errorCode}`);
  }
  return parts.join(', ');
}

function isVercelDeploymentProtection(response, body) {
  if (response.status !== 401) {
    return false;
  }

  const contentType = response.headers.get('content-type') || '';
  const setCookie = response.headers.get('set-cookie') || '';
  const rawBody = typeof body?.raw === 'string' ? body.raw : '';

  return (
    contentType.includes('text/html') &&
    (setCookie.includes('_vercel_sso_nonce') ||
      rawBody.includes('Vercel Authentication') ||
      rawBody.includes('Authentication Required'))
  );
}

async function checkHealth() {
  const { response, body } = await fetchJson('/api/health');
  if (isVercelDeploymentProtection(response, body)) {
    block(
      'Vercel deployment protection',
      'authenticate preview access with vercel curl, a trusted source token, or a protection-bypass token before API smoke',
    );
    return 'blocked';
  }

  if (response.status === 200 && body?.success === true) {
    pass('/api/health', 'target is reachable');
    return 'passed';
  } else {
    fail('/api/health', `expected HTTP 200 success:true, got HTTP ${response.status}`);
    return 'failed';
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
      `expected HTTP 401 UNAUTHORIZED JSON, got ${describeApiResponse(
        connectionResponse,
        connectionBody,
      )}`,
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
      `expected HTTP 401 UNAUTHORIZED JSON, got ${describeApiResponse(syncResponse, syncBody)}`,
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
      `checked=${body.checked} sent=${body.sent} failed=${body.failed} source=${cronSecretSource}`,
    );
    return;
  }

  fail(
    'Discord reminder cron',
    `expected cron result counts, got ${describeApiResponse(response, body)}`,
  );
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

function summarizeResults() {
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

async function main() {
  console.log(`[discord-beta-smoke] Base URL: ${baseUrl || '(invalid)'}`);
  if (!baseUrl) {
    summarizeResults();
    return;
  }

  const healthStatus = await checkHealth();
  if (healthStatus === 'blocked') {
    printManualChecklist();
    summarizeResults();
    return;
  }

  await checkUnauthenticatedGuards();
  const snapshot = await checkConnectionSnapshot();
  await saveChannelIfRequested(snapshot);
  await syncScheduledClassIfRequested();
  await runReminderCron();
  printManualChecklist();
  summarizeResults();
}

try {
  await main();
} catch (error) {
  fail('Discord beta smoke runtime', error instanceof Error ? error.message : String(error));
  summarizeResults();
}

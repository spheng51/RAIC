#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';

const DEFAULT_BASE_URL = 'https://open-raic.com';
const wantsHelp = process.argv.includes('--help') || process.argv.includes('-h');
const allowBlockers = process.argv.includes('--allow-blockers');
const evidencePath = (process.env.RAIC_DISCORD_SMOKE_EVIDENCE_PATH || '').trim();
const runStartedAt = new Date().toISOString();

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
const vercelBypassToken = (process.env.RAIC_DISCORD_SMOKE_VERCEL_BYPASS_TOKEN || '').trim();
const smokeCronSecret = (process.env.RAIC_DISCORD_SMOKE_CRON_SECRET || '').trim();
const fallbackCronSecret = (process.env.CRON_SECRET || '').trim();
const cronSecretSource = smokeCronSecret
  ? 'RAIC_DISCORD_SMOKE_CRON_SECRET'
  : fallbackCronSecret
    ? 'CRON_SECRET'
    : '';
const cronSecret = smokeCronSecret || fallbackCronSecret;

function normalizeBaseUrl(rawValue) {
  const parsed = new URL(rawValue);
  parsed.username = '';
  parsed.password = '';
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
  RAIC_DISCORD_SMOKE_CONNECTION_ID  Optional Discord connection id for automated channel save and scheduled-class sync.
  RAIC_DISCORD_SMOKE_CHANNEL_ID     Optional Discord channel id for automated channel save.
  RAIC_DISCORD_SMOKE_EVENT_ID       Optional scheduled class id for automated Discord sync.
  RAIC_DISCORD_SMOKE_CRON_SECRET    Preferred cron bearer token for this smoke. Falls back to CRON_SECRET.
  RAIC_DISCORD_SMOKE_VERCEL_BYPASS_TOKEN
                                      Optional Vercel Protection Bypass for Automation token for protected previews.
  RAIC_DISCORD_SMOKE_EVIDENCE_PATH  Optional local path for sanitized JSON smoke evidence.

Exit behavior:
  Fails on automated failures or missing live-smoke prerequisites.
  Use --allow-blockers to record blocked live-smoke prerequisites without failing.`);
}

function buildRequestUrl(path) {
  const requestUrl = new URL(path, baseUrl);
  if (vercelBypassToken) {
    requestUrl.searchParams.set('x-vercel-set-bypass-cookie', 'true');
    requestUrl.searchParams.set('x-vercel-protection-bypass', vercelBypassToken);
  }
  return requestUrl;
}

async function fetchJson(path, init = {}) {
  if (!baseUrl) {
    throw new Error('base URL is invalid');
  }

  let response;

  try {
    response = await fetch(buildRequestUrl(path), {
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
    parts.push(`redirected to ${redactUrlForLog(response.url)}`);
  }
  if (body?.errorCode) {
    parts.push(`errorCode=${body.errorCode}`);
  }
  return parts.join(', ');
}

function redactUrlForLog(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/(authorization|bypass|cookie|key|secret|token)/i.test(key)) {
        url.searchParams.set(key, 'redacted');
      }
    }
    return url.toString();
  } catch {
    return '[unparseable redirect URL]';
  }
}

function isDiscordScheduledEventUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    const pathParts = url.pathname.split('/').filter(Boolean);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'discord.com' &&
      !url.search &&
      !url.hash &&
      pathParts.length === 3 &&
      pathParts[0] === 'events'
    );
  } catch {
    return false;
  }
}

function describeDiscordSync(sync) {
  if (!sync) {
    return 'missing discordSync metadata';
  }

  const details = [`enabled=${String(sync.enabled)}`];
  if (sync.scheduledEventUrl) {
    details.push(`scheduledEventUrl=${redactUrlForLog(sync.scheduledEventUrl)}`);
  } else {
    details.push('scheduledEventUrl=missing');
  }
  if (sync.syncWarning) {
    details.push(`syncWarning=${sync.syncWarning}`);
  }
  return details.join(', ');
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
    fail(
      '/api/health',
      `expected HTTP 200 success:true, got ${describeApiResponse(response, body)}`,
    );
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

  const { response: cronResponse, body: cronBody } = await fetchJson(
    '/api/cron/discord-scheduled-class-reminders',
    { headers: { Cookie: '' } },
  );
  if (cronResponse.status === 403 && cronBody?.errorCode === 'FORBIDDEN') {
    pass('/api/cron/discord-scheduled-class-reminders unauth guard', 'cron secret is required');
  } else {
    fail(
      '/api/cron/discord-scheduled-class-reminders unauth guard',
      `expected HTTP 403 FORBIDDEN JSON, got ${describeApiResponse(cronResponse, cronBody)}`,
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
      `expected HTTP 200 success:true, got ${describeApiResponse(response, body)}`,
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

  fail(
    'Save Discord channel',
    `expected saved channel ${channelId}, got ${describeApiResponse(response, body)}`,
  );
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
    {
      method: 'POST',
      ...(connectionId ? { body: JSON.stringify({ connectionId }) } : {}),
    },
  );
  const sync = body?.event?.discordSync;
  if (
    response.status === 200 &&
    body?.success === true &&
    sync?.enabled === true &&
    isDiscordScheduledEventUrl(sync.scheduledEventUrl)
  ) {
    pass('Sync scheduled class', redactUrlForLog(sync.scheduledEventUrl));
    return;
  }

  fail(
    'Sync scheduled class',
    `expected Discord scheduled event URL, got ${describeApiResponse(
      response,
      body,
    )}; ${describeDiscordSync(sync)}`,
  );
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
    'Sign in as a teacher, connect a disposable Discord server, and verify Studio returns with ?discord=connected. Before Discord app config exists, ?discord=not_configured is the expected preflight signal.',
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

function buildSummary() {
  const failures = results.filter((result) => result.status === 'fail');
  const blockers = results.filter((result) => result.status === 'block');
  const manualSteps = results.filter((result) => result.status === 'manual');

  return {
    automatedPassed: results.length - failures.length - blockers.length - manualSteps.length,
    failed: failures.length,
    blocked: blockers.length,
    manual: manualSteps.length,
  };
}

function resolveExitCode(summary) {
  return summary.failed > 0 || (summary.blocked > 0 && !allowBlockers) ? 1 : 0;
}

async function writeEvidenceArtifact(summary, exitCode) {
  if (!evidencePath) {
    return;
  }

  const payload = {
    script: 'discord-beta-smoke',
    generatedAt: new Date().toISOString(),
    startedAt: runStartedAt,
    baseUrl,
    allowBlockers,
    preconditions: {
      hasTeacherCookie: Boolean(teacherCookie),
      hasConnectionId: Boolean(connectionId),
      hasChannelId: Boolean(channelId),
      hasEventId: Boolean(eventId),
      hasVercelBypassToken: Boolean(vercelBypassToken),
      cronSecretSource: cronSecretSource || null,
    },
    summary,
    results,
    exitCode,
    redaction: {
      policy:
        'request cookies, cron secrets, and Vercel bypass tokens are never serialized; diagnostic URLs are normalized or redacted before recording',
    },
  };

  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[discord-beta-smoke] Evidence JSON: ${evidencePath}`);
}

async function summarizeResults() {
  const summary = buildSummary();
  const exitCode = resolveExitCode(summary);

  console.log('');
  console.log(
    `[discord-beta-smoke] Summary: ${summary.automatedPassed} automated passed, ${summary.failed} failed, ${summary.blocked} blocked, ${summary.manual} manual checks listed`,
  );

  try {
    await writeEvidenceArtifact(summary, exitCode);
  } catch (error) {
    console.error(
      `[discord-beta-smoke] Failed to write evidence JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
    return;
  }

  process.exitCode = exitCode;
}

async function main() {
  console.log(`[discord-beta-smoke] Base URL: ${baseUrl || '(invalid)'}`);
  if (!baseUrl) {
    await summarizeResults();
    return;
  }

  const healthStatus = await checkHealth();
  if (healthStatus === 'blocked') {
    printManualChecklist();
    await summarizeResults();
    return;
  }

  await checkUnauthenticatedGuards();
  const snapshot = await checkConnectionSnapshot();
  await saveChannelIfRequested(snapshot);
  await syncScheduledClassIfRequested();
  await runReminderCron();
  printManualChecklist();
  await summarizeResults();
}

try {
  await main();
} catch (error) {
  fail('Discord beta smoke runtime', error instanceof Error ? error.message : String(error));
  await summarizeResults();
}

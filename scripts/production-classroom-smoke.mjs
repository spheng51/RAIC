#!/usr/bin/env node

import process from 'node:process';

const DEFAULT_BASE_URL = 'https://open-raic.com';
const baseUrl = normalizeBaseUrl(process.env.RAIC_PRODUCTION_BASE_URL || DEFAULT_BASE_URL);
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
  console.log(`[classroom-smoke] ${prefix} ${label}${detail ? ` - ${detail}` : ''}`);
}

function pass(label, detail) {
  record('pass', label, detail);
}

function fail(label, detail) {
  record('fail', label, detail);
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
    pass('/api/health', 'production API is reachable');
  } else {
    fail('/api/health', `expected HTTP 200 success:true, got HTTP ${response.status}`);
  }
}

async function checkShareGuards() {
  const { response: publishResponse, body: publishBody } = await fetchJson(
    '/api/classroom/publish-local',
    {
      method: 'POST',
      body: JSON.stringify({
        stage: { id: 'unauth-smoke', name: 'Unauth smoke', createdAt: 1, updatedAt: 1 },
        scenes: [],
      }),
    },
  );

  if (publishResponse.status === 401 && publishBody?.errorCode === 'UNAUTHORIZED') {
    pass('/api/classroom/publish-local unauth guard', 'publish still requires teacher auth');
  } else {
    fail(
      '/api/classroom/publish-local unauth guard',
      `expected HTTP 401 UNAUTHORIZED, got HTTP ${publishResponse.status}`,
    );
  }

  const { response: scheduleResponse, body: scheduleBody } =
    await fetchJson('/api/scheduled-classes');
  if (scheduleResponse.status === 401 && scheduleBody?.errorCode === 'UNAUTHORIZED') {
    pass('/api/scheduled-classes unauth guard', 'schedule data is not public');
  } else {
    fail(
      '/api/scheduled-classes unauth guard',
      `expected HTTP 401 UNAUTHORIZED, got HTTP ${scheduleResponse.status}`,
    );
  }
}

function printManualChecklist() {
  console.log('');
  console.log('[classroom-smoke] Manual signed-in checklist');
  manual(
    'Create disposable classroom',
    'Use a name like "SMOKE DELETE ME YYYY-MM-DD" and avoid real student data.',
  );
  manual(
    'Make shareable',
    'Confirm publish completes, no HTTP 413 appears, and /classroom/{id}?share=1 opens the share dialog.',
  );
  manual(
    'Create join link',
    'Create a short-lived link, open it in a student/incognito context, and submit a display name.',
  );
  manual(
    'Schedule multiplayer Game class',
    'In Studio, switch to Game mode, add a disposable scheduled class, enable Multiplayer game class, confirm invite/copy appears, then delete the row.',
  );
  manual(
    'Asset warning behavior',
    'If any local media cannot upload, confirm the warning detail panel lists the affected asset and the share dialog still opens.',
  );
}

async function main() {
  console.log(`[classroom-smoke] Base URL: ${baseUrl}`);
  await checkHealth();
  await checkShareGuards();
  printManualChecklist();

  const failures = results.filter((result) => result.status === 'fail');
  const manualSteps = results.filter((result) => result.status === 'manual');

  console.log('');
  console.log(
    `[classroom-smoke] Summary: ${
      results.length - failures.length - manualSteps.length
    } automated passed, ${failures.length} failed, ${manualSteps.length} manual checks listed`,
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await main();

#!/usr/bin/env node

import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const REQUIRED_READINESS_PATHS = [
  ['storage', 'ready'],
  ['mirofish', 'ready'],
  ['auth', 'ready'],
  ['encryption', 'ready'],
];

function fail(message) {
  console.error(`\n[mirofish:deployment] ${message}`);
  process.exit(1);
}

function getEnv(name, { required = false, fallback } = {}) {
  const value = process.env[name]?.trim() || fallback;
  if (required && !value) {
    fail(`Missing required environment variable: ${name}`);
  }
  return value ?? '';
}

function normalizeBaseUrl(rawValue, label) {
  if (!rawValue) {
    fail(`${label} is required`);
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch (error) {
    fail(`${label} is not a valid URL: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(`${label} must use http or https`);
  }

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

async function fetchWithRetries(url, options = {}, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }

      lastError = new Error(`${response.status} ${response.statusText}`.trim());
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await delay(750 * attempt);
    }
  }

  throw lastError;
}

function readNestedValue(object, path) {
  return path.reduce(
    (current, key) =>
      current && typeof current === 'object' && key in current ? current[key] : undefined,
    object,
  );
}

async function verifyHealth(baseUrl) {
  const response = await fetchWithRetries(new URL('/api/health', baseUrl), {
    headers: {
      Accept: 'application/json',
    },
  });
  const payload = await response.json();

  if (!payload || payload.success !== true || !payload.readiness) {
    fail('Deployment health endpoint returned an unexpected payload');
  }

  console.log(`[mirofish:deployment] Health endpoint: ${new URL('/api/health', baseUrl)}`);

  for (const path of REQUIRED_READINESS_PATHS) {
    const value = readNestedValue(payload.readiness, path);
    if (value !== true) {
      const group = path[0];
      const reason = payload.readiness?.[group]?.reason ?? 'unknown reason';
      fail(`Readiness check failed for ${group}: ${reason}`);
    }
    console.log(`[mirofish:deployment] Readiness ${path[0]}: ok`);
  }
}

async function verifyWrapperRoute(url, label) {
  const response = await fetchWithRetries(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Cache-Control': 'no-store',
    },
  });
  const contentType = response.headers.get('content-type') ?? 'unknown';
  const body = await response.text();

  if (!body.trim()) {
    fail(`${label} responded successfully but returned an empty body`);
  }

  console.log(`[mirofish:deployment] ${label}: ok (${contentType})`);
}

async function main() {
  const deploymentBaseUrl = normalizeBaseUrl(
    getEnv('RAIC_DEPLOYMENT_BASE_URL', {
      fallback: process.env.APP_BASE_URL?.trim(),
    }),
    'RAIC_DEPLOYMENT_BASE_URL',
  );
  const wrapperBaseUrl = normalizeBaseUrl(
    getEnv('MIROFISH_BASE_URL', { required: true }),
    'MIROFISH_BASE_URL',
  );
  const simulationId = getEnv('MIROFISH_STAGING_SIMULATION_ID', { required: true });
  const reportId = getEnv('MIROFISH_STAGING_REPORT_ID');

  console.log(`[mirofish:deployment] Deployment base URL: ${deploymentBaseUrl}`);
  console.log(`[mirofish:deployment] Wrapper base URL: ${wrapperBaseUrl}`);

  await verifyHealth(deploymentBaseUrl);

  const simulationUrl = new URL(
    `/simulation/${encodeURIComponent(simulationId)}/start`,
    wrapperBaseUrl,
  );
  simulationUrl.searchParams.set('embed', '1');
  simulationUrl.searchParams.set('classroomToken', 'probe-classroom-token');
  simulationUrl.searchParams.set('participantToken', 'probe-participant-token');
  simulationUrl.searchParams.set('mirofishSessionId', 'probe-session-id');
  await verifyWrapperRoute(simulationUrl, 'Wrapper simulation route');

  if (reportId) {
    const reportUrl = new URL(`/report/${encodeURIComponent(reportId)}`, wrapperBaseUrl);
    reportUrl.searchParams.set('embed', '1');
    reportUrl.searchParams.set('classroomToken', 'probe-classroom-token');
    reportUrl.searchParams.set('participantToken', 'probe-participant-token');
    reportUrl.searchParams.set('mirofishSessionId', 'probe-session-id');
    await verifyWrapperRoute(reportUrl, 'Wrapper report route');
  } else {
    console.log(
      '[mirofish:deployment] Skipping report route probe because MIROFISH_STAGING_REPORT_ID is not set',
    );
  }

  console.log('[mirofish:deployment] Deployment verification passed');
}

await main();

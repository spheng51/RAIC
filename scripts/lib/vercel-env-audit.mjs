export const REQUIRED_PRODUCTION_KEYS = [
  'DATABASE_URL',
  'RAIC_SECRET_ENCRYPTION_KEY',
  'BLOB_READ_WRITE_TOKEN',
  'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_ID',
];

export const LLM_PROVIDER_KEY_CANDIDATES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'DEEPSEEK_API_KEY',
  'QWEN_API_KEY',
  'KIMI_API_KEY',
  'MINIMAX_API_KEY',
  'GLM_API_KEY',
  'SILICONFLOW_API_KEY',
  'DOUBAO_API_KEY',
  'OPENROUTER_API_KEY',
  'GROK_API_KEY',
  'TENCENT_API_KEY',
  'TENCENT_HUNYUAN_API_KEY',
  'XIAOMI_API_KEY',
  'MIMO_API_KEY',
];

export const FEATURE_ENV_REQUIREMENTS = {
  discord: {
    label: 'Discord scheduled-class beta',
    keys: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN', 'CRON_SECRET'],
  },
};

export const FEATURE_ENV_ALIASES = {
  discord: 'discord',
  'discord-beta': 'discord',
  'discord-scheduled-class': 'discord',
  'discord-scheduled-classes': 'discord',
  discord_beta: 'discord',
  discord_scheduled_class: 'discord',
  discord_scheduled_classes: 'discord',
};

export function parseAuditContexts(rawValue = 'production') {
  const contexts = String(rawValue)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return contexts.length > 0 ? [...new Set(contexts)] : ['production'];
}

export function parseRequiredFeatures(rawValue = '') {
  const normalizedRawValue = Array.isArray(rawValue) ? rawValue.join(',') : rawValue;
  const features = String(normalizedRawValue)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => FEATURE_ENV_ALIASES[entry] ?? entry);
  return [...new Set(features)];
}

export function envTargets(envRecord) {
  const rawTargets = envRecord?.target ?? envRecord?.targets ?? [];
  if (Array.isArray(rawTargets)) {
    return rawTargets.map(String);
  }
  if (typeof rawTargets === 'string' && rawTargets.trim()) {
    return [rawTargets.trim()];
  }
  return [];
}

export function sanitizeEnvRecords(envRecords = []) {
  return envRecords
    .filter((envRecord) => envRecord?.key)
    .map((envRecord) => {
      const sanitized = { key: String(envRecord.key) };
      if (Array.isArray(envRecord.target)) {
        sanitized.target = envRecord.target.map(String);
      } else if (typeof envRecord.target === 'string' && envRecord.target.trim()) {
        sanitized.target = envRecord.target.trim();
      }
      if (Array.isArray(envRecord.targets)) {
        sanitized.targets = envRecord.targets.map(String);
      } else if (typeof envRecord.targets === 'string' && envRecord.targets.trim()) {
        sanitized.targets = envRecord.targets.trim();
      }
      return sanitized;
    });
}

export function parseVercelEnvListJson(rawValue) {
  const body = JSON.parse(rawValue);
  const envRecords = Array.isArray(body) ? body : body?.envs;
  if (!Array.isArray(envRecords)) {
    throw new Error('Vercel env list JSON did not contain an env array.');
  }
  return sanitizeEnvRecords(envRecords);
}

export function envAppliesToContext(envRecord, context) {
  return envTargets(envRecord).includes(context);
}

export function keysForContext(envRecords, context) {
  return new Set(
    envRecords
      .filter((envRecord) => envRecord?.key && envAppliesToContext(envRecord, context))
      .map((envRecord) => envRecord.key),
  );
}

export function auditEnvRecords({
  envRecords,
  contexts = ['production'],
  requiredKeys = REQUIRED_PRODUCTION_KEYS,
  llmProviderKeys = LLM_PROVIDER_KEY_CANDIDATES,
  requiredFeatures = '',
  featureRequirements = FEATURE_ENV_REQUIREMENTS,
}) {
  const normalizedRequiredFeatures = parseRequiredFeatures(requiredFeatures);
  const unknownRequiredFeatures = normalizedRequiredFeatures.filter(
    (feature) => !featureRequirements[feature],
  );
  const knownRequiredFeatures = normalizedRequiredFeatures.filter(
    (feature) => featureRequirements[feature],
  );

  return contexts.map((context) => {
    const presentKeys = keysForContext(envRecords, context);
    const missingRequiredKeys = requiredKeys.filter((key) => !presentKeys.has(key));
    const presentLlmProviderKeys = llmProviderKeys.filter((key) => presentKeys.has(key));
    const requiredFeatureEnvs = knownRequiredFeatures.map((feature) => {
      const requirement = featureRequirements[feature];
      const missingFeatureKeys = requirement.keys.filter((key) => !presentKeys.has(key));
      return {
        feature,
        label: requirement.label,
        required: requirement.keys.map((key) => ({ key, present: presentKeys.has(key) })),
        missingRequiredKeys: missingFeatureKeys,
        ok: missingFeatureKeys.length === 0,
      };
    });

    return {
      context,
      required: requiredKeys.map((key) => ({ key, present: presentKeys.has(key) })),
      missingRequiredKeys,
      presentLlmProviderKeys,
      llmProviderReady: presentLlmProviderKeys.length > 0,
      requiredFeatureEnvs,
      unknownRequiredFeatures,
      ok:
        missingRequiredKeys.length === 0 &&
        presentLlmProviderKeys.length > 0 &&
        requiredFeatureEnvs.every((feature) => feature.ok) &&
        unknownRequiredFeatures.length === 0,
    };
  });
}

export function summarizeAudit(auditResults) {
  const missingContexts = auditResults.filter((result) => !result.ok);
  return {
    ok: missingContexts.length === 0,
    missingContexts,
  };
}

export function manualFallbackLines({ projectId, teamId, contexts, requiredFeatures = '' }) {
  const normalizedRequiredFeatures = parseRequiredFeatures(requiredFeatures);
  const featureLines = normalizedRequiredFeatures
    .filter((feature) => FEATURE_ENV_REQUIREMENTS[feature])
    .map((feature) => {
      const requirement = FEATURE_ENV_REQUIREMENTS[feature];
      return `- Feature-required keys (${feature}): ${requirement.keys.join(', ')}.`;
    });

  return [
    '[vercel-env-audit] Manual fallback:',
    `- Open Vercel project environment settings for ${projectId || '<project id>'}.`,
    `- Scope/team: ${teamId || '<team id or personal scope>'}.`,
    `- Confirm these contexts: ${contexts.join(', ')}.`,
    `- Required keys: ${REQUIRED_PRODUCTION_KEYS.join(', ')}.`,
    `- At least one LLM provider key: ${LLM_PROVIDER_KEY_CANDIDATES.join(', ')}.`,
    ...featureLines,
    '- Do not paste or print secret values; record only present/missing status.',
  ];
}

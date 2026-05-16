const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'required']);

export function parseRequiredFeatures(rawValue) {
  return new Set(
    String(rawValue || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isRequiredFeature(featureName, env = process.env) {
  const normalized = featureName.trim().toLowerCase();
  const listedFeatures = parseRequiredFeatures(env.RAIC_REQUIRED_PRODUCTION_FEATURES);
  const explicitFlag = env[`RAIC_REQUIRE_${normalized.toUpperCase()}_SMOKE`];
  return (
    listedFeatures.has(normalized) || TRUE_VALUES.has(String(explicitFlag || '').toLowerCase())
  );
}

export function getProviderGroup(groups, groupName) {
  const group = groups?.[groupName];
  return group && typeof group === 'object' ? group : {};
}

export function getEnabledSecretProviders(groups, groupName) {
  return Object.entries(getProviderGroup(groups, groupName))
    .filter(([, entry]) => entry?.enabled === true && entry?.hasSecret === true)
    .map(([providerId, entry]) => ({
      providerId,
      allowedModels: Array.isArray(entry.allowedModels) ? entry.allowedModels : [],
    }));
}

export function getFirstEnabledSecretProvider(groups, groupName) {
  return getEnabledSecretProviders(groups, groupName)[0] ?? null;
}

export function evaluateOptionalProviderFeature({
  groups,
  groupName,
  featureName,
  env = process.env,
}) {
  const enabledProviders = getEnabledSecretProviders(groups, groupName);
  if (enabledProviders.length > 0) {
    return {
      status: 'pass',
      detail: `${enabledProviders.map((entry) => entry.providerId).join(', ')} configured`,
    };
  }

  if (isRequiredFeature(featureName, env)) {
    return {
      status: 'block',
      detail: `${featureName} is required for this release but no server-backed provider is enabled`,
    };
  }

  return {
    status: 'skip',
    detail: `${featureName} is not required for this release`,
  };
}

export function findUnconfiguredLlmProbe(groups) {
  const llmGroup = getProviderGroup(groups, 'llm');
  const candidate = Object.entries(llmGroup).find(([, entry]) => {
    const models = Array.isArray(entry?.allowedModels) ? entry.allowedModels : [];
    return entry?.enabled !== true && entry?.hasSecret !== true && models.length > 0;
  });

  if (!candidate) {
    return null;
  }

  const [providerId, entry] = candidate;
  return {
    providerId,
    modelId: entry.allowedModels[0],
  };
}

export function isFriendlyProviderError(responseStatus, body) {
  if (responseStatus !== 400) {
    return false;
  }

  const errorCode = body?.errorCode;
  return errorCode === 'MISSING_API_KEY' || errorCode === 'INVALID_REQUEST';
}

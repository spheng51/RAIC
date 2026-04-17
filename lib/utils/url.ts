function normalizeAddress(value: string): string {
  let normalized = value.trim().toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  return normalized.replace(/\.+$/, '');
}

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      return Number.NaN;
    }
    return Number.parseInt(part, 10);
  });

  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return octets;
}

function extractMappedIPv4(ip: string): string | null {
  const normalized = normalizeAddress(ip);
  if (!normalized.startsWith('::ffff:')) {
    return null;
  }

  const suffix = normalized.slice('::ffff:'.length);
  const dottedIPv4 = parseIPv4(suffix);
  if (dottedIPv4) {
    return dottedIPv4.join('.');
  }

  const parts = suffix.split(':');
  if (parts.length !== 2 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }

  const [high, low] = parts.map((part) => Number.parseInt(part, 16));
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

function getFirstIPv6Hextet(ip: string): number | null {
  const normalized = normalizeAddress(ip);
  if (!normalized.includes(':')) {
    return null;
  }

  if (normalized.startsWith('::')) {
    return 0;
  }

  const [firstHextet] = normalized.split(':');
  if (!firstHextet || !/^[0-9a-f]{1,4}$/.test(firstHextet)) {
    return null;
  }

  return Number.parseInt(firstHextet, 16);
}

function isPrivateIP(ip: string): boolean {
  const normalized = normalizeAddress(ip);
  const mappedIPv4 = extractMappedIPv4(normalized);
  if (mappedIPv4) {
    return isPrivateIP(mappedIPv4);
  }

  const ipv4 = parseIPv4(normalized);
  if (ipv4) {
    const [first, second] = ipv4;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  const ipv6FirstHextet = getFirstIPv6Hextet(normalized);
  if (ipv6FirstHextet === null) {
    return false;
  }

  if (normalized === '::' || normalized === '::1') {
    return true;
  }

  return (
    (ipv6FirstHextet & 0xfe00) === 0xfc00 ||
    (ipv6FirstHextet & 0xffc0) === 0xfe80 ||
    (ipv6FirstHextet & 0xffc0) === 0xfec0
  );
}

export function getHostnameFromUrl(value?: string | null): string | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return normalizeAddress(parsed.hostname);
  } catch {
    return null;
  }
}

export function isLocalOrPrivateHostname(hostname?: string | null): boolean {
  if (!hostname?.trim()) {
    return false;
  }

  const normalized = normalizeAddress(hostname);
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.local') ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    isPrivateIP(normalized)
  );
}

export function isLocalOrPrivateBaseUrl(baseUrl?: string | null): boolean {
  const hostname = getHostnameFromUrl(baseUrl);
  return isLocalOrPrivateHostname(hostname);
}

export function isHostedOrigin(hostname?: string | null): boolean {
  if (!hostname?.trim()) {
    return false;
  }

  return !isLocalOrPrivateHostname(hostname);
}

export function isLocalOnlyProvider(providerId?: string | null): boolean {
  return providerId === 'lmstudio' || providerId === 'ollama';
}

export function hasHostedLocalProviderTopologyMismatch(params: {
  providerId?: string | null;
  originHostname?: string | null;
  baseUrl?: string | null;
}): boolean {
  return (
    isLocalOnlyProvider(params.providerId) &&
    isHostedOrigin(params.originHostname) &&
    isLocalOrPrivateBaseUrl(params.baseUrl)
  );
}

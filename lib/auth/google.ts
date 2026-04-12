import 'server-only';

interface GoogleJwtHeader {
  alg: string;
  kid: string;
  typ?: string;
}

interface GoogleJwtPayload {
  iss: string;
  aud: string;
  azp?: string;
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  nonce?: string;
  exp: number;
  iat?: number;
}

interface GoogleJwk {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

interface GoogleJwksResponse {
  keys: GoogleJwk[];
}

declare global {
  // eslint-disable-next-line no-var
  var __raicGoogleJwks:
    | {
        expiresAt: number;
        keys: GoogleJwk[];
      }
    | undefined;
}

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

function base64UrlToUint8Array(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Uint8Array.from(Buffer.from(normalized + padding, 'base64'));
}

function decodeJwtPart<T>(value: string): T {
  const bytes = base64UrlToUint8Array(value);
  return JSON.parse(Buffer.from(bytes).toString('utf-8')) as T;
}

function getGoogleClientId() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID or NEXT_PUBLIC_GOOGLE_CLIENT_ID must be configured');
  }
  return clientId;
}

function parseCacheMaxAge(cacheControl: string | null) {
  if (!cacheControl) return 5 * 60;
  const match = cacheControl.match(/max-age=(\d+)/i);
  return match ? Number(match[1]) : 5 * 60;
}

async function getGoogleJwks() {
  const cached = globalThis.__raicGoogleJwks;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }

  const response = await fetch(GOOGLE_JWKS_URL, {
    method: 'GET',
    cache: 'force-cache',
    next: { revalidate: 60 * 60 },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google JWKS: ${response.status}`);
  }

  const body = (await response.json()) as GoogleJwksResponse;
  const maxAgeSeconds = parseCacheMaxAge(response.headers.get('cache-control'));

  globalThis.__raicGoogleJwks = {
    keys: body.keys,
    expiresAt: Date.now() + maxAgeSeconds * 1000,
  };

  return body.keys;
}

async function importGoogleKey(jwk: GoogleJwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['verify'],
  );
}

async function verifySignature(
  headerSegment: string,
  payloadSegment: string,
  signatureSegment: string,
  jwk: GoogleJwk,
) {
  const key = await importGoogleKey(jwk);
  const data = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
  const signature = base64UrlToUint8Array(signatureSegment);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
}

export async function verifyGoogleIdToken(input: {
  idToken: string;
  expectedNonce: string;
}) {
  const tokenParts = input.idToken.split('.');
  if (tokenParts.length !== 3) {
    throw new Error('Malformed Google credential');
  }

  const [headerSegment, payloadSegment, signatureSegment] = tokenParts;
  const header = decodeJwtPart<GoogleJwtHeader>(headerSegment);
  const payload = decodeJwtPart<GoogleJwtPayload>(payloadSegment);

  if (header.alg !== 'RS256') {
    throw new Error('Unsupported Google credential algorithm');
  }

  const jwks = await getGoogleJwks();
  const jwk = jwks.find((candidate) => candidate.kid === header.kid);
  if (!jwk) {
    throw new Error('Unable to find Google signing key');
  }

  const isValidSignature = await verifySignature(headerSegment, payloadSegment, signatureSegment, jwk);
  if (!isValidSignature) {
    throw new Error('Google credential signature verification failed');
  }

  if (!GOOGLE_ISSUERS.has(payload.iss)) {
    throw new Error('Unexpected Google token issuer');
  }

  if (payload.aud !== getGoogleClientId()) {
    throw new Error('Google credential audience mismatch');
  }

  if (payload.exp * 1000 <= Date.now()) {
    throw new Error('Google credential has expired');
  }

  if (!input.expectedNonce.trim()) {
    throw new Error('Google sign-in nonce is required');
  }

  if (payload.nonce !== input.expectedNonce) {
    throw new Error('Google credential nonce mismatch');
  }

  if (!payload.email || !payload.sub) {
    throw new Error('Google credential is missing required identity claims');
  }

  const emailVerified =
    payload.email_verified === true || payload.email_verified === 'true';
  if (!emailVerified) {
    throw new Error('Google account email must be verified');
  }

  return {
    googleSub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    displayName: payload.name?.trim() || payload.email,
    avatarUrl: payload.picture?.trim() || null,
  };
}

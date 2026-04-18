import { createHmac, timingSafeEqual } from 'crypto';

export const ACCESS_CODE_COOKIE_NAME = 'openraic_access';
export const ACCESS_CODE_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const ACCESS_CODE_TOKEN_TTL_MS = ACCESS_CODE_TOKEN_TTL_SECONDS * 1000;

export function createAccessToken(accessCode: string) {
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', accessCode).update(timestamp).digest('hex');
  return `${timestamp}.${signature}`;
}

export function verifyAccessToken(token: string, accessCode: string) {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  const issuedAt = Number.parseInt(timestamp, 10);

  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > ACCESS_CODE_TOKEN_TTL_MS) {
    return false;
  }

  const expectedSignature = createHmac('sha256', accessCode).update(timestamp).digest('hex');
  const provided = Buffer.from(signature, 'hex');
  const expected = Buffer.from(expectedSignature, 'hex');

  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}

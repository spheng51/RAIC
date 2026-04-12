import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ENCRYPTION_ENV_KEY = 'RAIC_SECRET_ENCRYPTION_KEY';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_VERSION = 'v1';

function decodeConfiguredKey(rawKey: string): Buffer {
  const trimmed = rawKey.trim();

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  try {
    const base64Decoded = Buffer.from(trimmed, 'base64');
    if (base64Decoded.length === 32) {
      return base64Decoded;
    }
  } catch {
    // Fall through to hashed passphrase mode.
  }

  return createHash('sha256').update(trimmed, 'utf8').digest();
}

function getEncryptionKey(): Buffer | null {
  const configured = process.env[ENCRYPTION_ENV_KEY];
  if (!configured?.trim()) {
    return null;
  }

  return decodeConfiguredKey(configured);
}

export function hasEncryptionKeyConfigured() {
  return getEncryptionKey() !== null;
}

export function requireEncryptionKey() {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      `${ENCRYPTION_ENV_KEY} is required for server-backed AI credential storage.`,
    );
  }

  return key;
}

export function encryptSecret(secret: string) {
  const key = requireEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload: string) {
  const key = requireEncryptionKey();
  const [version, ivEncoded, tagEncoded, encryptedEncoded] = payload.split(':');

  if (
    version !== ENCRYPTION_VERSION ||
    !ivEncoded ||
    !tagEncoded ||
    !encryptedEncoded
  ) {
    throw new Error('Encrypted AI credential payload is invalid.');
  }

  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(ivEncoded, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

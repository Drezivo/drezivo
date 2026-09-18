import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Canonical form used only for recipient lookup and provider correlation. */
export function normalizeRecipientEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}

export function digestRecipientEmail(email: string): string {
  const key = decodeKey(config.INVITATION_EMAIL_DIGEST_KEY, 'INVITATION_EMAIL_DIGEST_KEY');
  return createHmac('sha256', key).update(normalizeRecipientEmail(email), 'utf8').digest('hex');
}

/** Versioned envelope: v1.base64(iv).base64(ciphertext).base64(tag). */
export function encryptRecipientEmail(email: string): string {
  const key = decodeKey(config.INVITATION_EMAIL_ENCRYPTION_KEY, 'INVITATION_EMAIL_ENCRYPTION_KEY');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(normalizeRecipientEmail(email), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

export function decryptRecipientEmail(value: string): string {
  const [version, ivValue, ciphertextValue, tagValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !ciphertextValue || !tagValue) {
    throw new Error('Unsupported protected recipient value.');
  }
  const key = decodeKey(config.INVITATION_EMAIL_ENCRYPTION_KEY, 'INVITATION_EMAIL_ENCRYPTION_KEY');
  const iv = Buffer.from(ivValue, 'base64url');
  const ciphertext = Buffer.from(ciphertextValue, 'base64url');
  const tag = Buffer.from(tagValue, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Invalid protected recipient value.');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return normalizeRecipientEmail(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
  );
}

function decodeKey(value: string, name: string): Buffer {
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== KEY_BYTES) {
    throw new Error(`${name} must decode to exactly 32 bytes.`);
  }
  return decoded;
}

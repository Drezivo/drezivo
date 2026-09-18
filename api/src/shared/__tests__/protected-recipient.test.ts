import { describe, expect, it } from 'vitest';

import {
  decryptRecipientEmail,
  digestRecipientEmail,
  encryptRecipientEmail,
  normalizeRecipientEmail,
} from '../protected-recipient.js';

describe('protected invitation recipient material', () => {
  it('normalizes, hashes, and encrypts without exposing the email', () => {
    const input = '  Owner@Example.COM ';
    const normalized = normalizeRecipientEmail(input);
    const ciphertext = encryptRecipientEmail(input);

    expect(normalized).toBe('owner@example.com');
    expect(digestRecipientEmail(input)).toBe(digestRecipientEmail('owner@example.com'));
    expect(ciphertext).not.toContain('owner@example.com');
    expect(decryptRecipientEmail(ciphertext)).toBe(normalized);
  });

  it('rejects malformed or tampered ciphertext', () => {
    expect(() => decryptRecipientEmail('v1.invalid.invalid.invalid')).toThrow();
    const ciphertext = encryptRecipientEmail('recipient@example.com');
    const parts = ciphertext.split('.');
    const ciphertextPart = parts[2];
    if (!ciphertextPart) throw new Error('test ciphertext is missing');
    parts[2] = `${ciphertextPart[0] === 'A' ? 'B' : 'A'}${ciphertextPart.slice(1)}`;
    expect(() => decryptRecipientEmail(parts.join('.'))).toThrow();
  });
});

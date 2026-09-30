import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { config } from '../../config/index.js';
import { DependencyUnavailableError } from '../../shared/errors.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Provider-side de-duplication so an at-least-once retry does not send twice. */
  idempotencyKey: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Development only: each message becomes one JSON file a developer can open. */
export class FileEmailSender implements EmailSender {
  constructor(private readonly directory: string) {}

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`;
    await writeFile(join(this.directory, name), JSON.stringify(message, null, 2), 'utf8');
  }
}

/** Resend HTTP API. Plain-text messages only, so no template can inject markup. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey,
        },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new DependencyUnavailableError('The email provider could not be reached.');
    }
    if (!response.ok) {
      throw new DependencyUnavailableError(`The email provider rejected the message (HTTP ${response.status}).`);
    }
  }
}

/** The configured sender, or null when email is switched off. */
export function createEmailSender(): EmailSender | null {
  if (config.EMAIL_PROVIDER === 'resend' && config.RESEND_API_KEY && config.EMAIL_FROM) {
    return new ResendEmailSender(config.RESEND_API_KEY, config.EMAIL_FROM);
  }
  if (config.EMAIL_PROVIDER === 'file' && config.EMAIL_FILE_SINK_DIR) {
    return new FileEmailSender(config.EMAIL_FILE_SINK_DIR);
  }
  return null;
}

export const emailEnabled = (): boolean => config.EMAIL_PROVIDER !== 'none';

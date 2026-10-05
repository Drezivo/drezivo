import {
  extractedClothingFields,
  type ExtractedClothingFields,
} from '@drezivo/contracts';

import { config } from '../../config/index.js';
import { withTenantTransaction } from '../../db/client.js';
import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import {
  DependencyUnavailableError,
  NotFoundError,
  RateLimitedError,
} from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { readFileObject } from '../files/files.repository.js';

/** Photos above this are not sent to the model; catalogue cards are far smaller. */
const MAX_EXTRACT_BYTES = 8 * 1024 * 1024;
const READ_URL_TTL_SECONDS = 120;
const DEFAULT_RETRY_AFTER_SECONDS = 20;

export interface VisionSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

/** Configured only when all three provider settings are present (config enforces all-or-none). */
export function visionSettings(): VisionSettings | null {
  const { CATALOGUE_VISION_BASE_URL, CATALOGUE_VISION_MODEL, CATALOGUE_VISION_API_KEY } = config;
  if (!CATALOGUE_VISION_BASE_URL || !CATALOGUE_VISION_MODEL || !CATALOGUE_VISION_API_KEY) return null;
  return {
    baseUrl: CATALOGUE_VISION_BASE_URL.replace(/\/+$/, ''),
    model: CATALOGUE_VISION_MODEL,
    apiKey: CATALOGUE_VISION_API_KEY,
    timeoutMs: config.CATALOGUE_VISION_TIMEOUT_MS,
  };
}

export const EMPTY_EXTRACTION: ExtractedClothingFields = {
  name: null,
  rental_price_minor: null,
  size_label: null,
  free_size: false,
  measurement_unit: null,
  measurements: {},
  color_label: null,
};

const SYSTEM_PROMPT =
  'You read product cards for a clothing rental shop and copy out the details printed on them. ' +
  'Reply with exactly one JSON object and nothing else. Never invent a value that is not shown.';

const USER_PROMPT = `Return this JSON object:
{"name": string|null, "rental_price": number|null, "size": string|null, "free_size": boolean,
 "unit": "in"|"cm"|null, "measurements": {"<Label>": number}, "color": string|null}

Rules:
- name: the garment's name, usually the large title. A decorative first letter belongs to the word. Title Case, e.g. "Mirabelle".
- rental_price: the rental fee as a plain number, e.g. 800 for "P800" or "₱800". Not a deposit.
- measurements: numbers printed for body measurements, keyed in Title Case, e.g. "BUST: 30 IN" -> {"Bust": 30}. Leave out any measurement written as FS or free size.
- unit: "in" for IN, INCH or INCHES; "cm" for CM. null when no measurement is shown.
- size: a printed size such as "S", "Medium" or "Small-XL"; null when none is shown.
- free_size: true when the card says FS, free size or freesize anywhere.
- color: the garment's main colour in one or two words, judged from the photo.
- Ignore the shop name, address, social media handles, website and rental instructions.`;

type ModelReply = {
  name?: unknown;
  rental_price?: unknown;
  size?: unknown;
  free_size?: unknown;
  unit?: unknown;
  measurements?: unknown;
  color?: unknown;
};

/**
 * Turns the model's reply into validated suggestions. Anything malformed is dropped rather than
 * trusted: the reply is untrusted text, and the owner reviews every row before saving.
 */
export function parseModelReply(text: string): ExtractedClothingFields {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return EMPTY_EXTRACTION;
  let raw: ModelReply;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as ModelReply;
  } catch {
    return EMPTY_EXTRACTION;
  }

  const text_ = (value: unknown, max: number): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
  };
  const price = typeof raw.rental_price === 'string'
    ? Number(raw.rental_price.replace(/[^0-9.]/g, ''))
    : raw.rental_price;
  const measurements: Record<string, number> = {};
  if (raw.measurements && typeof raw.measurements === 'object' && !Array.isArray(raw.measurements)) {
    for (const [label, value] of Object.entries(raw.measurements as Record<string, unknown>)) {
      const key = label.trim().slice(0, 80);
      if (key && typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10_000) {
        measurements[key] = value;
      }
    }
  }
  const unit = raw.unit === 'in' || raw.unit === 'cm' ? raw.unit : null;

  const candidate = {
    name: text_(raw.name, 200),
    rental_price_minor:
      typeof price === 'number' && Number.isFinite(price) && price >= 0 && price < 10_000_000
        ? String(Math.round(price * 100))
        : null,
    size_label: text_(raw.size, 40),
    free_size: raw.free_size === true,
    measurement_unit: Object.keys(measurements).length > 0 ? unit : null,
    measurements,
    color_label: text_(raw.color, 80),
  };
  const parsed = extractedClothingFields.safeParse(candidate);
  return parsed.success ? parsed.data : EMPTY_EXTRACTION;
}

export interface ExtractDependencies {
  storage?: ObjectStorage;
  fetchImpl?: typeof fetch;
  settings?: VisionSettings | null;
}

export async function extractClothingPhoto(
  input: { tenantId: string; principalId: string; fileId: string },
  dependencies: ExtractDependencies = {},
): Promise<ExtractedClothingFields> {
  const settings = dependencies.settings === undefined ? visionSettings() : dependencies.settings;
  if (!settings) throw new DependencyUnavailableError('Reading details from photos is not set up.');
  const storage = dependencies.storage ?? objectStorage;
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  const file = await withTenantTransaction(input.tenantId, input.principalId, (client) =>
    readFileObject(client, input.tenantId, input.fileId),
  );
  if (
    !file ||
    file.purpose !== 'catalogue_image' ||
    file.lifecycle_status !== 'accepted' ||
    Number(file.byte_size) > MAX_EXTRACT_BYTES
  ) {
    throw new NotFoundError('The photo could not be found.');
  }

  const read = await storage.authorizeRead({
    storageKey: file.storage_key,
    versionId: file.version_id,
    expiresInSeconds: READ_URL_TTL_SECONDS,
  });
  const image = await fetchImpl(read.readUrl, { signal: AbortSignal.timeout(settings.timeoutMs) }).catch(() => null);
  if (!image?.ok) throw new DependencyUnavailableError('The photo could not be read. Try again.');
  const bytes = Buffer.from(await image.arrayBuffer());
  const dataUrl = `data:${file.mime_type};base64,${bytes.toString('base64')}`;

  let response: Response;
  try {
    response = await fetchImpl(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${settings.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        max_tokens: 400,
        // One user message, no system role: some providers (e.g. Gemma models on the Gemini API)
        // reject system instructions, and every OpenAI-compatible endpoint accepts this shape.
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `${SYSTEM_PROMPT}

${USER_PROMPT}` },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(settings.timeoutMs),
    });
  } catch {
    throw new DependencyUnavailableError('The photo reader did not answer in time. Try again.');
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new RateLimitedError(
      'The photo reader is busy. Waiting before the next photo.',
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : DEFAULT_RETRY_AFTER_SECONDS,
    );
  }
  if (!response.ok) {
    // Status only: the provider body can echo request details and never belongs in logs.
    logger.warn({ status: response.status, model: settings.model }, 'catalogue photo extraction failed');
    throw new DependencyUnavailableError('The photo reader is unavailable right now.');
  }

  const payload = (await response.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: unknown } }> }
    | null;
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? parseModelReply(content) : EMPTY_EXTRACTION;
}

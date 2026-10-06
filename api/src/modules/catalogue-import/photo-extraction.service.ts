import {
  MAX_UPLOAD_BYTES,
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
  fit_range: null,
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
 "fit_range": string|null, "unit": "in"|"cm"|null,
 "measurements": {"<Label>": number|{"type":"fit_note","text":string}}, "color": string|null}

Rules:
- name: the garment's name, usually the large title. A decorative first letter belongs to the word. Title Case, e.g. "Mirabelle".
- rental_price: the rental fee as a plain number, e.g. 800 for "P800" or "₱800". Not a deposit.
- measurements: copy exact numeric body measurements, e.g. "WAIST: 28 IN" -> {"Waist": 28}; for an explicit dimension note such as "BUST: FS", use {"Bust":{"type":"fit_note","text":"Flexible fit"}}. Do not use hips as a standard field; keep any other clearly printed dimension under its own label.
- unit: "in" for IN, INCH or INCHES; "cm" for CM. null when no measurement is shown.
- size: a printed labeled variant size such as "S" or "Medium"; null for a flexible-fit variant or when none is shown.
- fit_range: only an explicitly printed wearer-size range for the flexible-fit variant (e.g. "Small-XL"); null if none is printed. Do not infer a range from "FS", "free size" or "freesize" alone.
- free_size: true when the card says FS, free size or freesize anywhere.
- color: the garment's main colour in one or two words, judged from the photo.
- Ignore the shop name, address, social media handles, website and rental instructions.`;

type ModelReply = {
  name?: unknown;
  rental_price?: unknown;
  size?: unknown;
  fit_range?: unknown;
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
  const measurements: Record<string, number | { type: 'fit_note'; text: string }> = {};
  if (raw.measurements && typeof raw.measurements === 'object' && !Array.isArray(raw.measurements)) {
    for (const [label, value] of Object.entries(raw.measurements as Record<string, unknown>)) {
      const key = label.trim().slice(0, 80);
      if (key && typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10_000) {
        measurements[key] = value;
      } else if (key && typeof value === 'string' && value.trim()) {
        const note = /^(fs|free\s*size|freesize)$/i.test(value.trim()) ? 'Flexible fit' : value.trim();
        if (note.length <= 120) measurements[key] = { type: 'fit_note', text: note };
      } else if (
        key && typeof value === 'object' && value !== null &&
        (value as { type?: unknown }).type === 'fit_note' &&
        typeof (value as { text?: unknown }).text === 'string'
      ) {
        const rawNote = ((value as { text: string }).text).trim();
        const note = /^(fs|free\s*size|freesize)$/i.test(rawNote) ? 'Flexible fit' : rawNote;
        if (note && note.length <= 120) measurements[key] = { type: 'fit_note', text: note };
      }
    }
  }
  const unit = raw.unit === 'in' || raw.unit === 'cm' ? raw.unit : null;
  const size = text_(raw.size, 40);
  const explicitRange = text_(raw.fit_range, 120) ?? (raw.free_size === true && size && /\b(?:to|through)\b|[-–—]/i.test(size) ? size : null);

  const candidate = {
    name: text_(raw.name, 200),
    rental_price_minor:
      typeof price === 'number' && Number.isFinite(price) && price >= 0 && price < 10_000_000
        ? String(Math.round(price * 100))
        : null,
    size_label: raw.free_size === true ? null : size,
    fit_range: raw.free_size === true ? explicitRange : null,
    free_size: raw.free_size === true,
    measurement_unit: Object.values(measurements).some((value) => typeof value === 'number') ? unit : null,
    measurements,
    color_label: text_(raw.color, 80),
  };
  const parsed = extractedClothingFields.safeParse(candidate);
  return parsed.success ? parsed.data : EMPTY_EXTRACTION;
}

function geminiNativeGemmaEndpoint(settings: VisionSettings): string | null {
  if (!/^gemma-4-/i.test(settings.model)) return null;

  let baseUrl: URL;
  try {
    baseUrl = new URL(settings.baseUrl);
  } catch {
    return null;
  }
  if (baseUrl.hostname !== 'generativelanguage.googleapis.com') return null;

  const apiPath = baseUrl.pathname.replace(/\/openai\/?$/i, '').replace(/\/$/, '');
  return `${baseUrl.origin}${apiPath}/models/${encodeURIComponent(settings.model)}:generateContent`;
}

function openAiCompatibleContent(payload: unknown): string | null {
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)
    ?.choices?.[0]?.message?.content;
  return typeof content === 'string' && content.trim() ? content : null;
}

function nativeGeminiContent(payload: unknown): string | null {
  const parts = (
    payload as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }>;
    } | null
  )?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;

  const content = parts
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
    .trim();
  return content || null;
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
    Number(file.byte_size) > MAX_UPLOAD_BYTES
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
  const base64 = bytes.toString('base64');
  const dataUrl = `data:${file.mime_type};base64,${base64}`;
  const nativeGemmaEndpoint = geminiNativeGemmaEndpoint(settings);

  let response: Response;
  try {
    response = nativeGemmaEndpoint
      ? await fetchImpl(nativeGemmaEndpoint, {
          method: 'POST',
          headers: { 'x-goog-api-key': settings.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: `${SYSTEM_PROMPT}\n\n${USER_PROMPT}` },
                  { inline_data: { mime_type: file.mime_type, data: base64 } },
                ],
              },
            ],
            generationConfig: { temperature: 0, maxOutputTokens: 400 },
          }),
          signal: AbortSignal.timeout(settings.timeoutMs),
        })
      : await fetchImpl(`${settings.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${settings.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: settings.model,
            temperature: 0,
            max_tokens: 400,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: `${SYSTEM_PROMPT}\n\n${USER_PROMPT}` },
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
    logger.warn(
      {
        status: response.status,
        model: settings.model,
        transport: nativeGemmaEndpoint ? 'gemini-native' : 'openai-compatible',
      },
      'catalogue photo extraction failed',
    );
    if (response.status === 401 || response.status === 403) {
      throw new DependencyUnavailableError('The photo reader credentials were rejected. Check its API key.');
    }
    if ([400, 404, 415, 422].includes(response.status)) {
      throw new DependencyUnavailableError('The configured photo model rejected the image request. Check the model setting.');
    }
    throw new DependencyUnavailableError('The photo reader is unavailable right now.');
  }

  const payload = await response.json().catch(() => null);
  const content = nativeGemmaEndpoint ? nativeGeminiContent(payload) : openAiCompatibleContent(payload);
  if (!content) throw new DependencyUnavailableError('The photo reader returned an unreadable response. Try again.');
  return parseModelReply(content);
}

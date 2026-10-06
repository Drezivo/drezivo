import { beforeEach, describe, expect, it, vi } from 'vitest';

const file = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
}));

vi.mock('../../../db/client.js', () => ({
  withTenantTransaction: (_tenant: string, _principal: string, fn: (client: unknown) => unknown) => fn({}),
}));
vi.mock('../../files/files.repository.js', () => ({
  readFileObject: vi.fn(() => Promise.resolve(file.row)),
}));

const { EMPTY_EXTRACTION, extractClothingPhoto, parseModelReply } = await import('../photo-extraction.service.js');

const settings = { baseUrl: 'https://vision.test/v1', model: 'test/vision', apiKey: 'sk-test-0000000000', timeoutMs: 5_000 };
const gemmaSettings = {
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: 'gemma-4-31b-it',
  apiKey: 'test-google-key',
  timeoutMs: 5_000,
};
const openRouterSettings = {
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'inclusionai/ling-3.0-flash-vl:free,openrouter/free',
  apiKey: 'sk-or-test-key',
  timeoutMs: 5_000,
};
const storage = {
  authorizeUpload: vi.fn(),
  inspectUploadedObject: vi.fn(),
  authorizeRead: vi.fn(() => Promise.resolve({ readUrl: 'https://storage.test/photo.jpg', expiresAt: new Date() })),
};
const input = { tenantId: 'tenant', principalId: 'user', fileId: 'file' };

function reply(content: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers });
}

describe('parseModelReply', () => {
  it('reads an evening-dress card: name, fee in centavos, inch measurements', () => {
    const fields = parseModelReply(
      'Here you go: ```json\n{"name":"Mirabelle","rental_price":500,"size":null,"free_size":false,"unit":"in","measurements":{"Bust":30,"Waist":24,"Length":22},"color":"Blush pink"}\n```',
    );
    expect(fields).toEqual({
      name: 'Mirabelle',
      rental_price_minor: '50000',
      size_label: null,
      free_size: false,
      measurement_unit: 'in',
      measurements: { Bust: 30, Waist: 24, Length: 22 },
      color_label: 'Blush pink',
    });
  });

  it('reads a wedding-gown card with a free-size range and a price written as text', () => {
    const fields = parseModelReply(
      '{"name":"Astrid","rental_price":"P1,000","size":"Small-XL","free_size":true,"unit":null,"measurements":{},"color":"White"}',
    );
    expect(fields).toMatchObject({
      name: 'Astrid',
      rental_price_minor: '100000',
      size_label: 'Small-XL',
      free_size: true,
      measurement_unit: null,
    });
  });

  it('drops anything malformed instead of trusting it', () => {
    expect(parseModelReply('no json here')).toEqual(EMPTY_EXTRACTION);
    expect(parseModelReply('{broken')).toEqual(EMPTY_EXTRACTION);
    expect(
      parseModelReply('{"name": 12, "rental_price": -5, "measurements": {"Bust": "thirty", "Waist": 1e9}, "unit": "ft"}'),
    ).toEqual(EMPTY_EXTRACTION);
  });

  it('keeps the unit only when a measurement survived', () => {
    expect(parseModelReply('{"unit":"cm","measurements":{"Bust":"FS"}}').measurement_unit).toBeNull();
  });
});

describe('extractClothingPhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    file.row = {
      purpose: 'catalogue_image',
      lifecycle_status: 'accepted',
      byte_size: '120000',
      storage_key: 'tenant/photo.jpg',
      version_id: 'v1',
      mime_type: 'image/jpeg',
    };
  });

  it('sends the photo inline to the configured OpenAI-compatible model and parses the reply', async () => {
    const fetchImpl = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('https://storage.test')
          ? new Response(new Uint8Array([1, 2, 3]))
          : reply('{"name":"Lisette","rental_price":800,"measurements":{},"free_size":false}'),
      ),
    );

    const fields = await extractClothingPhoto(input, {
      settings,
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fields).toMatchObject({ name: 'Lisette', rental_price_minor: '80000' });
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://vision.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test-0000000000');
    const body = JSON.parse(init.body as string) as { model: string; messages: unknown };
    expect(body.model).toBe('test/vision');
    expect(JSON.stringify(body.messages)).toContain('data:image/jpeg;base64,AQID');
    // A single user turn: Gemma models on the Gemini API refuse a separate system message.
    expect((body.messages as Array<{ role: string }>).map((message) => message.role)).toEqual(['user']);
  });

  it('uses Google native generateContent for Gemma 4 image requests', async () => {
    const fetchImpl = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('https://storage.test')
          ? new Response(new Uint8Array([1, 2, 3]))
          : new Response(
              JSON.stringify({
                candidates: [
                  {
                    content: {
                      parts: [
                        {
                          text: '{"name":"Astrid","rental_price":1000,"size":"Small-XL","free_size":true,"unit":null,"measurements":{},"color":"White"}',
                        },
                      ],
                    },
                  },
                ],
              }),
            ),
      ),
    );

    const fields = await extractClothingPhoto(input, {
      settings: gemmaSettings,
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fields).toMatchObject({
      name: 'Astrid',
      rental_price_minor: '100000',
      size_label: 'Small-XL',
      free_size: true,
    });
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent',
    );
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-google-key');
    const body = JSON.parse(init.body as string) as { contents: unknown };
    expect(JSON.stringify(body.contents)).toContain('"inline_data":{"mime_type":"image/jpeg","data":"AQID"}');
  });

  it('uses OpenRouter provider failover and model fallbacks for multimodal extraction', async () => {
    const fetchImpl = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('https://storage.test')
          ? new Response(new Uint8Array([1, 2, 3]))
          : reply('{"name":"Mira","rental_price":650,"measurements":{},"free_size":false}'),
      ),
    );

    const fields = await extractClothingPhoto(input, {
      settings: openRouterSettings,
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fields).toMatchObject({ name: 'Mira', rental_price_minor: '65000' });
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer sk-or-test-key',
      'HTTP-Referer': 'https://drezivo.shop',
      'X-Title': 'Drezivo',
    });
    const body = JSON.parse(init.body as string) as {
      models: string[];
      provider: { allow_fallbacks: boolean };
      messages: unknown;
    };
    expect(body.models).toEqual(['inclusionai/ling-3.0-flash-vl:free', 'openrouter/free']);
    expect(body.provider).toEqual({ allow_fallbacks: true });
    expect(JSON.stringify(body.messages)).toContain('data:image/jpeg;base64,AQID');
  });

  it('accepts the full catalogue upload size range instead of refusing 8-10 MB photos', async () => {
    file.row = { ...file.row, byte_size: String(9 * 1024 * 1024) };
    const fetchImpl = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('https://storage.test')
          ? new Response(new Uint8Array([1]))
          : reply('{"name":"Large card","rental_price":500,"measurements":{},"free_size":false}'),
      ),
    );

    await expect(
      extractClothingPhoto(input, { settings, storage, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toMatchObject({ name: 'Large card' });
  });

  it('fails visibly when the provider returns no usable text instead of silently filling nothing', async () => {
    const fetchImpl = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('https://storage.test')
          ? new Response(new Uint8Array([1]))
          : new Response(JSON.stringify({ choices: [{ message: {} }] })),
      ),
    );

    await expect(
      extractClothingPhoto(input, { settings, storage, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({
      status: 503,
      message: 'The photo reader returned an unreadable response. Try again.',
    });
  });

  it('refuses photos that are not accepted catalogue images of this shop', async () => {
    const accepted = file.row;
    for (const row of [null, { ...accepted, purpose: 'payment_receipt' }, { ...accepted, lifecycle_status: 'pending_upload' }]) {
      file.row = row;
      await expect(extractClothingPhoto(input, { settings, storage, fetchImpl: vi.fn() })).rejects.toMatchObject({
        status: 404,
      });
    }
  });

  it('passes a provider rate limit back as 429 with Retry-After, and outages as 503', async () => {
    const photo = () => new Response(new Uint8Array([1]));
    const limited = vi.fn().mockResolvedValueOnce(photo()).mockResolvedValueOnce(reply('', 429, { 'retry-after': '12' }));
    await expect(extractClothingPhoto(input, { settings, storage, fetchImpl: limited })).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 12,
    });

    const down = vi.fn().mockResolvedValueOnce(photo()).mockResolvedValueOnce(reply('', 500));
    await expect(extractClothingPhoto(input, { settings, storage, fetchImpl: down })).rejects.toMatchObject({
      status: 503,
      message: 'The photo reader provider returned HTTP 500. Try again in a moment or check the staging provider logs.',
    });

    await expect(extractClothingPhoto(input, { settings: null, storage, fetchImpl: vi.fn() })).rejects.toMatchObject({
      status: 503,
      code: 'PHOTO_READER_CONFIGURATION',
    });
  });

  it('returns a useful error when the configured model rejects an image request', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1])))
      .mockResolvedValueOnce(reply('', 400));

    await expect(
      extractClothingPhoto(input, { settings, storage, fetchImpl }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'PHOTO_READER_CONFIGURATION',
      message: 'The configured photo model rejected the image request. Check the model setting.',
    });
  });
});

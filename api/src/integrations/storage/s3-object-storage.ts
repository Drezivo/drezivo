import { createHash, createHmac } from 'node:crypto';

import { config } from '../../config/index.js';
import { DependencyUnavailableError } from '../../shared/errors.js';
import type { ObjectStorage, UploadAuthorization, UploadedObjectMetadata } from './object-storage.js';

const SERVICE = 's3';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const SIGNING_ALGORITHM = 'AWS4-HMAC-SHA256';

export class S3ObjectStorage implements ObjectStorage {
  authorizeUpload(input: {
    storageKey: string;
    contentType: string;
    sha256: string;
    expiresInSeconds: number;
  }): Promise<UploadAuthorization> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.expiresInSeconds * 1000);
    const url = objectUrl(input.storageKey);
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const signedHeaders = 'content-type;host;x-amz-checksum-sha256';
    const credentialScope = `${dateStamp}/${config.AWS_REGION}/${SERVICE}/aws4_request`;

    const query = new URLSearchParams({
      'X-Amz-Algorithm': SIGNING_ALGORITHM,
      'X-Amz-Credential': `${config.S3_ACCESS_KEY_ID}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(input.expiresInSeconds),
      'X-Amz-SignedHeaders': signedHeaders,
    });
    const canonicalQuery = canonicalQueryString(query);
    const canonicalHeaders =
      `content-type:${normalizeHeaderValue(input.contentType)}\n` +
      `host:${url.host}\n` +
      `x-amz-checksum-sha256:${normalizeHeaderValue(input.sha256)}\n`;
    const canonicalRequest = [
      'PUT',
      canonicalUri(url),
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      SIGNING_ALGORITHM,
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = signString(dateStamp, stringToSign);
    query.set('X-Amz-Signature', signature);
    url.search = canonicalQueryString(query);

    return Promise.resolve({
      uploadUrl: url.toString(),
      requiredHeaders: {
        'Content-Type': input.contentType,
        'x-amz-checksum-sha256': input.sha256,
      },
      expiresAt,
    });
  }

  async inspectUploadedObject(storageKey: string): Promise<UploadedObjectMetadata | null> {
    const url = objectUrl(storageKey);
    const head = await signedFetch(url, 'HEAD', {
      'x-amz-checksum-mode': 'ENABLED',
    });
    if (head.status === 404) return null;
    if (!head.ok) {
      throw new DependencyUnavailableError('Object storage could not verify the uploaded file.');
    }

    const byteSize = Number(head.headers.get('content-length'));
    if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
      throw new DependencyUnavailableError('Object storage returned invalid file metadata.');
    }

    const prefixResponse = await signedFetch(url, 'GET', { range: 'bytes=0-15' });
    if (!prefixResponse.ok && prefixResponse.status !== 206) {
      throw new DependencyUnavailableError('Object storage could not inspect the uploaded file.');
    }
    const prefix = new Uint8Array(await prefixResponse.arrayBuffer());

    return {
      contentType: normalizeContentType(head.headers.get('content-type')),
      byteSize,
      sha256: head.headers.get('x-amz-checksum-sha256'),
      versionId: head.headers.get('x-amz-version-id'),
      prefix,
    };
  }
}

export const s3ObjectStorage = new S3ObjectStorage();

async function signedFetch(
  url: URL,
  method: 'GET' | 'HEAD',
  extraHeaders: Record<string, string>,
): Promise<Response> {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${config.AWS_REGION}/${SERVICE}/aws4_request`;
  const payloadHash = method === 'HEAD' ? EMPTY_SHA256 : 'UNSIGNED-PAYLOAD';
  const headers = new Headers(extraHeaders);
  headers.set('host', url.host);
  headers.set('x-amz-date', amzDate);
  headers.set('x-amz-content-sha256', payloadHash);

  const signedHeaderNames = Array.from(headers.keys())
    .map((name) => name.toLowerCase())
    .sort();
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalHeaders = `${signedHeaderNames
    .map((name) => `${name}:${normalizeHeaderValue(headers.get(name) ?? '')}`)
    .join('\n')}\n`;
  const canonicalRequest = [
    method,
    canonicalUri(url),
    canonicalQueryString(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const stringToSign = [
    SIGNING_ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = signString(dateStamp, stringToSign);
  headers.set(
    'authorization',
    `${SIGNING_ALGORITHM} Credential=${config.S3_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );

  try {
    return await fetch(url, { method, headers });
  } catch {
    throw new DependencyUnavailableError('Object storage is temporarily unavailable.');
  }
}

function objectUrl(storageKey: string): URL {
  const encodedKey = encodePath(storageKey);
  if (config.S3_ENDPOINT) {
    const endpoint = new URL(config.S3_ENDPOINT);
    const basePath = endpoint.pathname.replace(/\/$/, '');
    if (config.S3_FORCE_PATH_STYLE) {
      endpoint.pathname = `${basePath}/${encodeRfc3986(config.S3_BUCKET_PRIVATE)}/${encodedKey}`;
    } else {
      endpoint.hostname = `${config.S3_BUCKET_PRIVATE}.${endpoint.hostname}`;
      endpoint.pathname = `${basePath}/${encodedKey}`;
    }
    endpoint.search = '';
    return endpoint;
  }
  return new URL(
    `https://${config.S3_BUCKET_PRIVATE}.s3.${config.AWS_REGION}.amazonaws.com/${encodedKey}`,
  );
}

function canonicalUri(url: URL): string {
  return url.pathname || '/';
}

function canonicalQueryString(params: URLSearchParams): string {
  return Array.from(params.entries())
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
    )
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
}

function encodePath(value: string): string {
  return value.split('/').map(encodeRfc3986).join('/');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeContentType(value: string | null): string {
  return (value ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function signString(dateStamp: string, stringToSign: string): string {
  const dateKey = hmac(`AWS4${config.S3_SECRET_ACCESS_KEY}`, dateStamp);
  const regionKey = hmac(dateKey, config.AWS_REGION);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  return createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
}

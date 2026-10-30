import { createHash } from 'node:crypto';

import { strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_ENTRIES = 10_000;
const MAX_CSV_ROWS = 20_000;
const MAX_TOTAL_ROWS = 20_000;
const CELL_ESCAPE = '~DREZIVO-CELL~';
const CSV_FILES = ['categories.csv', 'products.csv', 'variants.csv', 'pieces.csv', 'measurement-guides.csv', 'product-images.csv'] as const;

export const CSV_HEADERS = {
  categories: ['id', 'name', 'status', 'display_order', 'created_at', 'updated_at'],
  products: ['id', 'category_id', 'code', 'name', 'description', 'subcategory', 'sizing_mode', 'status', 'created_at', 'updated_at'],
  variants: ['id', 'product_id', 'sku', 'size_label', 'color_label', 'measurements', 'fit_range', 'measurement_unit', 'measurement_mode', 'measurement_guide_id', 'rental_price_minor', 'security_deposit_minor', 'currency', 'pricing_mode', 'included_duration_minutes', 'extra_day_price_minor', 'prep_minutes', 'turnaround_minutes', 'status', 'created_at', 'updated_at'],
  pieces: ['id', 'branch_id', 'variant_id', 'asset_code', 'lifecycle_status', 'retired_by_product_archive', 'readiness', 'recovery_managed_readiness', 'custody_kind', 'condition_note', 'measurement_overrides', 'alteration_note', 'version', 'created_at', 'updated_at'],
  guides: ['id', 'name', 'status', 'is_default', 'created_at', 'updated_at', 'media_path', 'media_content_type', 'media_sha256'],
  images: ['id', 'product_id', 'display_order', 'created_at', 'media_path', 'media_content_type', 'media_sha256'],
} as const;

const manifestSchema = z.object({
  format: z.literal('drezivo-inventory-backup'),
  version: z.literal(1),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  exported_at: z.string().datetime({ offset: true }),
  counts: z.record(z.string(), z.number().int().nonnegative()),
}).strict();

export type BackupManifest = z.infer<typeof manifestSchema>;
export interface BackupMedia {
  path: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  sha256: string;
  bytes: Uint8Array;
}
export interface BackupRows {
  categories: Array<Record<string, string>>;
  products: Array<Record<string, string>>;
  variants: Array<Record<string, string>>;
  pieces: Array<Record<string, string>>;
  guides: Array<Record<string, string>>;
  images: Array<Record<string, string>>;
}
export interface ParsedBackup {
  manifest: BackupManifest;
  rows: BackupRows;
  media: Map<string, BackupMedia>;
}

export function encodeCsv(headers: readonly string[], rows: readonly Record<string, unknown>[]): Uint8Array {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(','));
  return strToU8(`${lines.join('\r\n')}\r\n`);
}

export function createCatalogueBackup(input: { manifest: BackupManifest; rows: BackupRows; media: BackupMedia[] }): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(input.manifest)),
    'categories.csv': encodeCsv(CSV_HEADERS.categories, input.rows.categories),
    'products.csv': encodeCsv(CSV_HEADERS.products, input.rows.products),
    'variants.csv': encodeCsv(CSV_HEADERS.variants, input.rows.variants),
    'pieces.csv': encodeCsv(CSV_HEADERS.pieces, input.rows.pieces),
    'measurement-guides.csv': encodeCsv(CSV_HEADERS.guides, input.rows.guides),
    'product-images.csv': encodeCsv(CSV_HEADERS.images, input.rows.images),
  };
  let totalBytes = Object.values(files).reduce((total, bytes) => total + bytes.byteLength, 0);
  const mediaPaths = new Set<string>();
  for (const media of input.media) {
    totalBytes += media.bytes.byteLength;
    if (!isAllowedMediaPath(media.path) || mediaPaths.has(media.path) || media.sha256 !== digest(media.bytes)) throw new Error('Catalogue backup media metadata is invalid.');
    mediaPaths.add(media.path);
    files[media.path] = media.bytes;
  }
  if (totalBytes > MAX_BACKUP_BYTES || Object.keys(files).length > MAX_BACKUP_ENTRIES) throw new Error('Catalogue backup exceeds the supported size or item limit.');
  const zip = zipSync(files, { level: 6 });
  if (zip.byteLength > MAX_BACKUP_BYTES) throw new Error('Catalogue backup exceeds the supported size limit.');
  return zip;
}

export function parseCatalogueBackup(bytes: Uint8Array): ParsedBackup {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_BACKUP_BYTES) throw new Error('The backup ZIP is empty or exceeds the supported size limit.');
  const entryNames = validateZipDirectory(bytes);
  let extracted: Record<string, Uint8Array>;
  try { extracted = unzipSync(bytes); } catch { throw new Error('The backup ZIP is malformed or cannot be read.'); }
  if (Object.keys(extracted).length !== entryNames.size || [...entryNames].some((name) => !(name in extracted))) throw new Error('The backup ZIP contains inconsistent entries.');
  const manifestBytes = extracted['manifest.json'];
  if (!manifestBytes) throw new Error('The backup ZIP is missing its manifest.');
  let manifestValue: unknown;
  try { manifestValue = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)); } catch { throw new Error('The backup manifest is invalid.'); }
  const parsedManifest = manifestSchema.safeParse(manifestValue);
  if (!parsedManifest.success) throw new Error('The backup manifest is invalid or unsupported.');

  const rows = {
    categories: parseCsv(extracted['categories.csv'], CSV_HEADERS.categories),
    products: parseCsv(extracted['products.csv'], CSV_HEADERS.products),
    variants: parseCsv(extracted['variants.csv'], CSV_HEADERS.variants),
    pieces: parseCsv(extracted['pieces.csv'], CSV_HEADERS.pieces),
    guides: parseCsv(extracted['measurement-guides.csv'], CSV_HEADERS.guides),
    images: parseCsv(extracted['product-images.csv'], CSV_HEADERS.images),
  };
  if (Object.values(rows).reduce((total, table) => total + table.length, 0) > MAX_TOTAL_ROWS) throw new Error('The backup exceeds the supported total record limit.');
  const media = new Map<string, BackupMedia>();
  for (const name of entryNames) {
    if (!name.startsWith('media/')) continue;
    const content = extracted[name];
    const row = [...rows.images, ...rows.guides].find((candidate) => candidate['media_path'] === name);
    const contentType = row?.['media_content_type'];
    const sha256 = row?.['media_sha256'];
    if (!content || !row || !isImageType(contentType) || !isSha256(sha256) || digest(content) !== sha256 || !hasImageSignature(content, contentType)) throw new Error('The backup contains invalid, corrupted, or unreferenced media.');
    if (!mediaPathMatchesRow(name, row, rows.images.includes(row) ? 'product-images' : 'measurement-guides', contentType)) throw new Error('The backup media does not match its record.');
    media.set(name, { path: name, contentType, sha256, bytes: content });
  }
  if ([...rows.images, ...rows.guides].some((row) => !media.has(row['media_path'] ?? ''))) throw new Error('The backup is missing referenced media.');
  validateBundleRelations(parsedManifest.data, rows);
  const expectedCounts = { categories: rows.categories.length, products: rows.products.length, variants: rows.variants.length, pieces: rows.pieces.length, measurement_guides: rows.guides.length, product_images: rows.images.length };
  for (const [key, count] of Object.entries(expectedCounts)) if (parsedManifest.data.counts[key] !== count) throw new Error('The backup counts do not match its contents.');
  return { manifest: parsedManifest.data, rows, media };
}

export function sha256Hex(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

function parseCsv(bytes: Uint8Array | undefined, expectedHeaders: readonly string[]): Array<Record<string, string>> {
  if (!bytes) throw new Error('The backup is missing a required CSV file.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  const matrix = readCsv(text);
  const headers = matrix.shift();
  if (!headers || headers.length !== expectedHeaders.length || headers.some((header, index) => header !== expectedHeaders[index])) throw new Error('A backup CSV has an unsupported header.');
  if (matrix.length > MAX_CSV_ROWS) throw new Error('A backup CSV exceeds the supported row limit.');
  return matrix.map((cells) => {
    if (cells.length !== headers.length) throw new Error('A backup CSV row has the wrong number of columns.');
    return Object.fromEntries(headers.map((header, index) => [header, decodeCell(cells[index] ?? '')]));
  });
}

function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let quoteClosed = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') { quoted = false; quoteClosed = true; }
      else cell += char;
    } else if (char === '"' && cell.length === 0 && !quoteClosed) quoted = true;
    else if (char === ',' || char === '\n' || char === '\r') {
      if (quoteClosed && char !== ',' && char !== '\n' && char !== '\r') throw new Error('A backup CSV has invalid quoting.');
      if (char === ',') { row.push(cell); cell = ''; quoteClosed = false; }
      else {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        row.push(cell); cell = ''; quoteClosed = false;
        if (row.some((value) => value !== '')) rows.push(row);
        row = [];
        if (rows.length > MAX_CSV_ROWS + 1) throw new Error('A backup CSV exceeds the supported row limit.');
      }
    } else {
      if (quoteClosed || char === '"') throw new Error('A backup CSV has invalid quoting.');
      cell += char;
    }
  }
  if (quoted) throw new Error('A backup CSV contains an unterminated quoted value.');
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function validateZipDirectory(bytes: Uint8Array): Set<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowerBound = Math.max(0, bytes.byteLength - 65_557);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= lowerBound; offset -= 1) if (view.getUint32(offset, true) === 0x06054b50) { endOffset = offset; break; }
  if (endOffset < 0) throw new Error('The backup ZIP directory is invalid.');
  const entries = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  const commentLength = view.getUint16(endOffset + 20, true);
  if (endOffset + 22 + commentLength !== bytes.byteLength || entries < 1 || entries > MAX_BACKUP_ENTRIES || entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff || directoryOffset + directorySize !== endOffset) throw new Error('The backup ZIP exceeds supported directory limits.');
  const names = new Set<string>();
  let cursor = directoryOffset;
  let totalExpanded = 0;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > directoryOffset + directorySize || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('The backup ZIP directory is malformed.');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const expanded = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const fileCommentLength = view.getUint16(cursor + 32, true);
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8) || compressed === 0xffffffff || expanded === 0xffffffff || cursor + 46 + nameLength + extraLength + fileCommentLength > directoryOffset + directorySize) throw new Error('The backup ZIP uses unsupported or unsafe features.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!isAllowedEntry(name) || names.has(name)) throw new Error('The backup ZIP contains an invalid or duplicate path.');
    names.add(name);
    totalExpanded += expanded;
    if (totalExpanded > MAX_BACKUP_BYTES || compressed > bytes.byteLength) throw new Error('The backup ZIP expands beyond the supported size limit.');
    cursor += 46 + nameLength + extraLength + fileCommentLength;
  }
  if (cursor !== directoryOffset + directorySize) throw new Error('The backup ZIP directory is inconsistent.');
  if (['manifest.json', ...CSV_FILES].some((name) => !names.has(name))) throw new Error('The backup ZIP is missing required files.');
  return names;
}

function validateBundleRelations(manifest: BackupManifest, rows: BackupRows): void {
  const categories = new Set(rows.categories.map((row) => uuid(row['id'], 'category ID')));
  const products = new Set(rows.products.map((row) => uuid(row['id'], 'product ID')));
  const variants = new Set(rows.variants.map((row) => uuid(row['id'], 'variant ID')));
  const guides = new Set(rows.guides.map((row) => uuid(row['id'], 'measurement guide ID')));
  for (const group of [rows.categories, rows.products, rows.variants, rows.pieces, rows.guides, rows.images]) {
    const ids = new Set<string>();
    for (const row of group) { const id = uuid(row['id'], 'record ID'); if (ids.has(id)) throw new Error('The backup contains duplicate record IDs.'); ids.add(id); }
  }
  for (const row of rows.products) if (row['category_id'] && !categories.has(row['category_id'] ?? '')) throw new Error('A product refers to a missing backup category.');
  for (const row of rows.variants) if (!products.has(row['product_id'] ?? '') || (row['measurement_guide_id'] && !guides.has(row['measurement_guide_id'] ?? ''))) throw new Error('A variant refers to a missing backup record.');
  for (const row of rows.pieces) if (row['branch_id'] !== manifest.branch_id || !variants.has(row['variant_id'] ?? '')) throw new Error('A piece has an invalid branch or variant relationship.');
  for (const row of rows.images) if (!products.has(row['product_id'] ?? '')) throw new Error('An image refers to a missing backup product.');
  assertUnique(rows.categories, (row) => row['name']?.trim().toLowerCase() ?? '', 'category names');
  assertUnique(rows.products, (row) => row['code']?.trim().toLowerCase() ?? '', 'product codes');
  assertUnique(rows.variants, (row) => row['sku']?.trim().toLowerCase() ?? '', 'variant SKUs');
  assertUnique(rows.pieces, (row) => row['asset_code']?.trim().toLowerCase() ?? '', 'piece codes');
  assertUnique(rows.images, (row) => `${row['product_id']}:${row['display_order']}`, 'product image positions');
  if (rows.guides.filter((row) => row['is_default'] === 'true' && row['status'] === 'active').length > 1) throw new Error('The backup contains multiple active default measurement guides.');
  const paths = [...rows.images, ...rows.guides].map((row) => row['media_path'] ?? '');
  if (new Set(paths).size !== paths.length) throw new Error('The backup reuses a media path.');
}

function assertUnique(rows: Array<Record<string, string>>, keyOf: (row: Record<string, string>) => string, label: string): void {
  const keys = rows.map(keyOf);
  if (new Set(keys).size !== keys.length) throw new Error(`The backup contains duplicate ${label}.`);
}

function csvCell(value: unknown): string {
  const raw = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  let safe = raw;
  if (safe.startsWith(CELL_ESCAPE)) safe = CELL_ESCAPE + safe;
  else if (/^[\s]*[=+\-@\t\r]/.test(safe)) safe = `${CELL_ESCAPE}${Buffer.from(safe, 'utf8').toString('base64')}`;
  return `"${safe.replaceAll('"', '""')}"`;
}

function decodeCell(value: string): string {
  if (value.startsWith(CELL_ESCAPE + CELL_ESCAPE)) return value.slice(CELL_ESCAPE.length);
  if (!value.startsWith(CELL_ESCAPE)) return value;
  const encoded = value.slice(CELL_ESCAPE.length);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('A backup CSV cell has an invalid escape value.');
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64'));
}

function isAllowedEntry(path: string): boolean { return path === 'manifest.json' || CSV_FILES.includes(path as typeof CSV_FILES[number]) || isAllowedMediaPath(path); }
function isAllowedMediaPath(path: string): boolean { return /^media\/(?:product-images|measurement-guides)\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(path); }
function isImageType(value: string | undefined): value is BackupMedia['contentType'] { return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp'; }
function isSha256(value: string | undefined): value is string { return Boolean(value && /^[a-f0-9]{64}$/i.test(value)); }
function mediaPathMatchesRow(path: string, row: Record<string, string>, folder: string, type: BackupMedia['contentType']): boolean {
  const id = row['id'];
  const extension = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp';
  return path === `media/${folder}/${id}.${extension}`;
}
function hasImageSignature(bytes: Uint8Array, type: BackupMedia['contentType']): boolean {
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
}
function ascii(bytes: Uint8Array, start: number, end: number): string { return String.fromCharCode(...bytes.subarray(start, end)); }
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function uuid(value: string | undefined, label: string): string { const parsed = z.string().uuid().safeParse(value); if (!parsed.success) throw new Error(`The backup contains an invalid ${label}.`); return parsed.data; }

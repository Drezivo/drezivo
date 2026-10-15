import { createReadStream } from 'node:fs';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const BACKUP_ROLE = 'drezivo_backup_reader';
const POSTGRES_TOOL_IMAGE = 'postgres:17.11-alpine3.24';
const POSTGRES_CLIENT_MAJOR = 17;
const AGE_VERSION = '1.3.2';
const SNAPSHOT_PREFIX = 'drezivo/database-backups/production/snapshots/';
const SNAPSHOT_RETENTION_COUNT = 7;
const MANIFEST_MAX_BYTES = 64 * 1024;
const PROCESS_OUTPUT_MAX_CHARS = 16 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface BackupConfig {
  readonly databaseConnectionString: string;
  readonly pgpassEntry: string;
  readonly projectRef: string;
  readonly r2AccountId: string;
  readonly r2AccessKeyId: string;
  readonly r2SecretAccessKey: string;
  readonly r2Bucket: string;
  readonly ageRecipient: string;
  readonly runId: string;
  readonly runAttempt: string;
}

export interface DatabaseIdentity {
  readonly currentUser: string;
  readonly currentDatabase: string;
  readonly serverVersion: string;
  readonly serverVersionNum: number;
  readonly isSuperuser: boolean;
  readonly bypassRls: boolean;
  readonly canCreateDatabase: boolean;
  readonly canCreateRole: boolean;
  readonly canReplicate: boolean;
  readonly defaultTransactionReadOnly: string;
  readonly canReadAllData: boolean;
  readonly hasPgNet: boolean;
  readonly hasExternalSchemaSelect: boolean;
}

export interface BackupFileInfo {
  readonly bytes: number;
  readonly sha256: string;
}

export interface SnapshotManifest {
  readonly version: 1;
  readonly snapshotKey: string;
  readonly createdAt: string;
  readonly schema: 'public';
  readonly format: 'pg_dump-custom';
  readonly serverVersion: string;
  readonly pgDumpVersion: string;
  readonly dumpBytes: number;
  readonly dumpSha256: string;
  readonly encryptedBytes: number;
  readonly encryptedSha256: string;
}

export interface BackupTools {
  getPgDumpVersion(workDirectory: string): Promise<string>;
  getAgeVersion(): Promise<string>;
  inspectDatabase(config: BackupConfig, workDirectory: string): Promise<DatabaseIdentity>;
  createDump(config: BackupConfig, workDirectory: string, dumpPath: string): Promise<void>;
  validateDump(workDirectory: string, dumpPath: string): Promise<void>;
  encrypt(dumpPath: string, encryptedPath: string, recipient: string): Promise<void>;
  fileInfo(filePath: string): Promise<BackupFileInfo>;
}

export interface SnapshotStore {
  readonly uploadAndVerifySnapshot: (
    key: string,
    filePath: string,
    info: BackupFileInfo,
  ) => Promise<void>;
  readonly uploadAndVerifyManifest: (key: string, body: Buffer) => Promise<void>;
  readonly listVerifiedSnapshots: () => Promise<readonly SnapshotManifest[]>;
  readonly deleteObject: (key: string) => Promise<void>;
}

export interface BackupResult {
  readonly snapshotKey: string;
  readonly encryptedBytes: number;
  readonly removedSnapshots: number;
}

export function resolveBackupConfig(environment: NodeJS.ProcessEnv): BackupConfig {
  const databaseUrlValue = requireValue(environment, 'SUPABASE_BACKUP_DATABASE_URL');
  const projectRef = requireValue(environment, 'SUPABASE_PROJECT_REF');
  const r2AccountId = requireValue(environment, 'R2_ACCOUNT_ID');
  const r2AccessKeyId = requireValue(environment, 'R2_ACCESS_KEY_ID');
  const r2SecretAccessKey = requireValue(environment, 'R2_SECRET_ACCESS_KEY');
  const r2Bucket = requireValue(environment, 'R2_BACKUP_BUCKET');
  const ageRecipient = requireValue(environment, 'AGE_RECIPIENT');
  const runId = requireValue(environment, 'GITHUB_RUN_ID');
  const runAttempt = requireValue(environment, 'GITHUB_RUN_ATTEMPT');

  if (!/^[a-z0-9-]{8,64}$/i.test(projectRef)) {
    throw new Error('SUPABASE_PROJECT_REF must be the expected Supabase project reference.');
  }
  if (!/^[a-f0-9]{32}$/i.test(r2AccountId)) {
    throw new Error('R2_ACCOUNT_ID must be a 32-character Cloudflare account ID.');
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(r2Bucket)) {
    throw new Error('R2_BACKUP_BUCKET must be a valid lowercase bucket name.');
  }
  if (!/^age1[023456789acdefghjklmnpqrstuvwxyz]{50,}$/.test(ageRecipient)) {
    throw new Error('AGE_RECIPIENT must be an age X25519 public recipient.');
  }
  if (!/^\d+$/.test(runId) || !/^\d+$/.test(runAttempt)) {
    throw new Error('GitHub run ID and attempt must be numeric.');
  }
  if (/[\r\n\0]/.test(r2AccessKeyId) || /[\r\n\0]/.test(r2SecretAccessKey)) {
    throw new Error('R2 credentials contain unsupported characters.');
  }

  const parsed = parseSupabaseBackupUrl(databaseUrlValue, projectRef);
  return {
    databaseConnectionString: parsed.connectionString,
    pgpassEntry: parsed.pgpassEntry,
    projectRef,
    r2AccountId: r2AccountId.toLowerCase(),
    r2AccessKeyId,
    r2SecretAccessKey,
    r2Bucket,
    ageRecipient,
    runId,
    runAttempt,
  };
}

function requireValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required for the production database backup.`);
  }
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`${name} contains unsupported characters.`);
  }
  return value;
}

function parseSupabaseBackupUrl(
  value: string,
  expectedProjectRef: string,
): { connectionString: string; pgpassEntry: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SUPABASE_BACKUP_DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('SUPABASE_BACKUP_DATABASE_URL must use the PostgreSQL protocol.');
  }
  if (url.hash) throw new Error('SUPABASE_BACKUP_DATABASE_URL must not contain a URL fragment.');

  let username: string;
  let password: string;
  let database: string;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error('SUPABASE_BACKUP_DATABASE_URL contains invalid URL encoding.');
  }

  if (!username || !password || !database) {
    throw new Error(
      'SUPABASE_BACKUP_DATABASE_URL must include the backup role, password, and database.',
    );
  }
  if (database !== 'postgres') {
    throw new Error('The backup connection must target the Supabase postgres database.');
  }

  const host = url.hostname.toLowerCase();
  const port = url.port || '5432';
  const directMatch = /^db\.([a-z0-9-]+)\.supabase\.co$/.exec(host);
  const isSessionPooler = host.endsWith('.pooler.supabase.com');
  if (port !== '5432') {
    throw new Error('The backup connection must use Supabase direct or Session mode on port 5432.');
  }

  if (directMatch) {
    if (directMatch[1] !== expectedProjectRef || username !== BACKUP_ROLE) {
      throw new Error('The direct backup URL does not match the expected project and backup role.');
    }
  } else if (isSessionPooler) {
    if (username !== `${BACKUP_ROLE}.${expectedProjectRef}`) {
      throw new Error(
        'The Session pooler username does not match the expected project and backup role.',
      );
    }
  } else {
    throw new Error('The backup URL must use a Supabase direct endpoint or shared Session pooler.');
  }

  const sslMode = url.searchParams.get('sslmode');
  if (sslMode && !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error('The backup database connection must require TLS.');
  }

  const sanitizedUrl = new URL(url.toString());
  sanitizedUrl.password = '';
  sanitizedUrl.search = '';
  sanitizedUrl.searchParams.set('sslmode', sslMode ?? 'require');

  const passwordFileEntry = [host, port, database, username, password]
    .map(escapePasswordFileField)
    .join(':');
  return { connectionString: sanitizedUrl.toString(), pgpassEntry: passwordFileEntry };
}

function escapePasswordFileField(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
}

export function assertDatabaseIdentity(identity: DatabaseIdentity, pgDumpMajor: number): void {
  if (identity.currentUser !== BACKUP_ROLE || identity.currentDatabase !== 'postgres') {
    throw new Error('The connected database identity does not match the dedicated backup role.');
  }
  if (
    identity.isSuperuser ||
    !identity.bypassRls ||
    identity.canCreateDatabase ||
    identity.canCreateRole ||
    identity.canReplicate
  ) {
    throw new Error('The backup role has unsafe PostgreSQL attributes.');
  }
  if (identity.defaultTransactionReadOnly.toLowerCase() !== 'on') {
    throw new Error('The backup role must default to read-only transactions.');
  }
  if (identity.canReadAllData) {
    throw new Error('The backup role must not inherit the broad pg_read_all_data role.');
  }
  if (identity.hasExternalSchemaSelect) {
    throw new Error('The backup role has SELECT access outside the application public schema.');
  }
  if (identity.hasPgNet) {
    throw new Error(
      'pg_net is enabled; review its callable network functions before enabling backups.',
    );
  }

  const serverMajor = postgresMajorFromVersionNum(identity.serverVersionNum);
  if (pgDumpMajor < serverMajor) {
    throw new Error('The pg_dump client is older than the Supabase PostgreSQL server.');
  }
}

export function createPostgresToolArguments(
  workDirectory: string,
  command: readonly string[],
  userId: number | undefined,
  groupId: number | undefined,
): string[] {
  if (
    userId === undefined ||
    groupId === undefined ||
    !Number.isSafeInteger(userId) ||
    !Number.isSafeInteger(groupId) ||
    userId < 0 ||
    groupId < 0
  ) {
    throw new Error('The PostgreSQL tool container requires the runner user and group IDs.');
  }
  if (command.length === 0 || command.some((part) => part.length === 0)) {
    throw new Error('The PostgreSQL tool command is invalid.');
  }

  return [
    'run',
    '--rm',
    '--user',
    `${userId}:${groupId}`,
    '--network',
    'host',
    '--mount',
    `type=bind,source=${resolve(workDirectory)},target=/backup`,
    '--env',
    'PGPASSFILE=/backup/pgpass',
    '--env',
    'PGSSLMODE=require',
    '--env',
    'PGCONNECT_TIMEOUT=20',
    POSTGRES_TOOL_IMAGE,
    ...command,
  ];
}

function postgresMajorFromVersionNum(versionNum: number): number {
  if (!Number.isInteger(versionNum) || versionNum < 10000) {
    throw new Error('Supabase returned an invalid PostgreSQL server version.');
  }
  return Math.floor(versionNum / 10000);
}

function postgresMajorFromToolVersion(version: string): number {
  const match = /\b(\d+)\.\d+(?:\.\d+)?\b/.exec(version);
  if (!match?.[1]) throw new Error('The pg_dump client returned an unrecognized version.');
  return Number(match[1]);
}

function assertAgeVersion(version: string): void {
  if (!new RegExp(`\\b${AGE_VERSION.replaceAll('.', '\\.')}\\b`).test(version)) {
    throw new Error(`The age executable must be version ${AGE_VERSION}.`);
  }
}

export function createSnapshotKeys(
  createdAt: Date,
  runId: string,
  runAttempt: string,
): { snapshotKey: string; manifestKey: string } {
  if (!Number.isFinite(createdAt.getTime()) || !/^\d+$/.test(runId) || !/^\d+$/.test(runAttempt)) {
    throw new Error('Snapshot identity must contain a valid time and numeric workflow run values.');
  }
  const timestamp = createdAt.toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const snapshotKey = `${SNAPSHOT_PREFIX}snapshot-${timestamp}-${runId}-${runAttempt}.dump.age`;
  return { snapshotKey, manifestKey: manifestKeyForSnapshot(snapshotKey) };
}

export function manifestKeyForSnapshot(snapshotKey: string): string {
  return `${snapshotKey}.manifest.json`;
}

export function parseSnapshotManifest(value: unknown): SnapshotManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Snapshot manifest must be a JSON object.');
  }
  const manifest = value as Record<string, unknown>;
  const createdAt = manifest.createdAt;
  const snapshotKey = manifest.snapshotKey;
  const serverVersion = manifest.serverVersion;
  const pgDumpVersion = manifest.pgDumpVersion;
  const dumpBytes = manifest.dumpBytes;
  const encryptedBytes = manifest.encryptedBytes;

  if (
    manifest.version !== 1 ||
    manifest.schema !== 'public' ||
    manifest.format !== 'pg_dump-custom' ||
    typeof snapshotKey !== 'string' ||
    !snapshotKey.startsWith(SNAPSHOT_PREFIX) ||
    !snapshotKey.endsWith('.dump.age') ||
    typeof createdAt !== 'string' ||
    !Number.isFinite(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt ||
    typeof serverVersion !== 'string' ||
    serverVersion.length > 32 ||
    typeof pgDumpVersion !== 'string' ||
    pgDumpVersion.length > 64 ||
    typeof dumpBytes !== 'number' ||
    !Number.isSafeInteger(dumpBytes) ||
    dumpBytes <= 0 ||
    typeof encryptedBytes !== 'number' ||
    !Number.isSafeInteger(encryptedBytes) ||
    encryptedBytes <= 0 ||
    typeof manifest.dumpSha256 !== 'string' ||
    !SHA256_PATTERN.test(manifest.dumpSha256) ||
    typeof manifest.encryptedSha256 !== 'string' ||
    !SHA256_PATTERN.test(manifest.encryptedSha256)
  ) {
    throw new Error('Snapshot manifest is invalid or unsupported.');
  }

  return {
    version: 1,
    snapshotKey,
    createdAt,
    schema: 'public',
    format: 'pg_dump-custom',
    serverVersion,
    pgDumpVersion,
    dumpBytes,
    dumpSha256: manifest.dumpSha256,
    encryptedBytes,
    encryptedSha256: manifest.encryptedSha256,
  };
}

export function selectExpiredSnapshots(
  manifests: readonly SnapshotManifest[],
  currentSnapshotKey: string,
  keepCount = SNAPSHOT_RETENTION_COUNT,
): readonly SnapshotManifest[] {
  if (!Number.isSafeInteger(keepCount) || keepCount < 1) {
    throw new Error('Snapshot retention count must be a positive integer.');
  }
  const keys = new Set(manifests.map((manifest) => manifest.snapshotKey));
  if (keys.size !== manifests.length) {
    throw new Error('Duplicate snapshots were returned by the backup object store.');
  }
  if (!keys.has(currentSnapshotKey)) {
    throw new Error('The newly verified snapshot is missing from the backup object store.');
  }

  const newestFirst = [...manifests].sort((left, right) => {
    const byDate = right.createdAt.localeCompare(left.createdAt);
    return byDate || right.snapshotKey.localeCompare(left.snapshotKey);
  });
  if (
    !newestFirst.slice(0, keepCount).some((manifest) => manifest.snapshotKey === currentSnapshotKey)
  ) {
    throw new Error(
      'The newly verified snapshot is not among the newest snapshots; refusing retention.',
    );
  }
  return newestFirst.slice(keepCount).reverse();
}

export async function createDatabaseBackup(
  config: BackupConfig,
  tools: BackupTools,
  store: SnapshotStore,
  workDirectory: string,
  createdAt = new Date(),
): Promise<BackupResult> {
  const pgDumpVersion = await tools.getPgDumpVersion(workDirectory);
  const pgDumpMajor = postgresMajorFromToolVersion(pgDumpVersion);
  if (pgDumpMajor !== POSTGRES_CLIENT_MAJOR) {
    throw new Error(
      `The configured PostgreSQL tool image must provide pg_dump ${POSTGRES_CLIENT_MAJOR}.`,
    );
  }

  const ageVersion = await tools.getAgeVersion();
  assertAgeVersion(ageVersion);

  const identity = await tools.inspectDatabase(config, workDirectory);
  assertDatabaseIdentity(identity, pgDumpMajor);

  const dumpPath = join(workDirectory, 'database.dump');
  const encryptedPath = join(workDirectory, 'database.dump.age');
  await tools.createDump(config, workDirectory, dumpPath);
  await tools.validateDump(workDirectory, dumpPath);
  const dumpInfo = await tools.fileInfo(dumpPath);
  if (dumpInfo.bytes <= 0 || !SHA256_PATTERN.test(dumpInfo.sha256)) {
    throw new Error('The PostgreSQL dump is empty or failed checksum validation.');
  }

  await tools.encrypt(dumpPath, encryptedPath, config.ageRecipient);
  const encryptedInfo = await tools.fileInfo(encryptedPath);
  if (encryptedInfo.bytes <= 0 || !SHA256_PATTERN.test(encryptedInfo.sha256)) {
    throw new Error('The encrypted backup is empty or failed checksum validation.');
  }

  const { snapshotKey, manifestKey } = createSnapshotKeys(
    createdAt,
    config.runId,
    config.runAttempt,
  );
  const manifest = parseSnapshotManifest({
    version: 1,
    snapshotKey,
    createdAt: createdAt.toISOString(),
    schema: 'public',
    format: 'pg_dump-custom',
    serverVersion: identity.serverVersion,
    pgDumpVersion,
    dumpBytes: dumpInfo.bytes,
    dumpSha256: dumpInfo.sha256,
    encryptedBytes: encryptedInfo.bytes,
    encryptedSha256: encryptedInfo.sha256,
  });
  const manifestBody = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  let manifestCommitted = false;

  try {
    await store.uploadAndVerifySnapshot(snapshotKey, encryptedPath, encryptedInfo);
    await store.uploadAndVerifyManifest(manifestKey, manifestBody);
    manifestCommitted = true;

    const verifiedSnapshots = await store.listVerifiedSnapshots();
    const expired = selectExpiredSnapshots(verifiedSnapshots, snapshotKey);
    for (const oldSnapshot of expired) {
      await store.deleteObject(oldSnapshot.snapshotKey);
      await store.deleteObject(manifestKeyForSnapshot(oldSnapshot.snapshotKey));
    }

    return {
      snapshotKey,
      encryptedBytes: encryptedInfo.bytes,
      removedSnapshots: expired.length,
    };
  } catch (error) {
    if (!manifestCommitted) {
      await removePartialSnapshot(store, snapshotKey, manifestKey);
    }
    throw error;
  }
}

async function removePartialSnapshot(
  store: SnapshotStore,
  snapshotKey: string,
  manifestKey: string,
): Promise<void> {
  let cleanupFailed = false;
  for (const key of [manifestKey, snapshotKey]) {
    try {
      await store.deleteObject(key);
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) {
    console.warn('Could not remove an incomplete snapshot object; retention was not run.');
  }
}

class SystemBackupTools implements BackupTools {
  async getPgDumpVersion(workDirectory: string): Promise<string> {
    return this.runPostgresTool(workDirectory, 'pg_dump', ['pg_dump', '--version']);
  }

  async getAgeVersion(): Promise<string> {
    return runProcess('age', ['--version'], { label: 'age version check' });
  }

  async inspectDatabase(config: BackupConfig, workDirectory: string): Promise<DatabaseIdentity> {
    const query = `
      SELECT json_build_object(
        'currentUser', current_user,
        'currentDatabase', current_database(),
        'serverVersion', current_setting('server_version'),
        'serverVersionNum', current_setting('server_version_num')::integer,
        'isSuperuser', role.rolsuper,
        'bypassRls', role.rolbypassrls,
        'canCreateDatabase', role.rolcreatedb,
        'canCreateRole', role.rolcreaterole,
        'canReplicate', role.rolreplication,
        'defaultTransactionReadOnly', current_setting('default_transaction_read_only'),
        'canReadAllData', pg_has_role(current_user, 'pg_read_all_data', 'MEMBER'),
        'hasPgNet', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net'),
        'hasExternalSchemaSelect', EXISTS (
          SELECT 1
            FROM pg_class AS object
            JOIN pg_namespace AS schema ON schema.oid = object.relnamespace
           WHERE object.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
             AND schema.nspname NOT IN ('public', 'pg_catalog', 'information_schema')
             AND schema.nspname NOT LIKE 'pg_toast%'
             AND has_table_privilege(current_user, object.oid, 'SELECT')
        )
      )
        FROM pg_roles AS role
       WHERE role.rolname = current_user;
    `;
    const output = await this.runPostgresTool(workDirectory, 'database identity check', [
      'psql',
      '-XAt',
      '--no-password',
      '--set=ON_ERROR_STOP=1',
      '--dbname',
      config.databaseConnectionString,
      '--command',
      query,
    ]);

    try {
      const parsed: unknown = JSON.parse(output.trim());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      return parseDatabaseIdentity(parsed as Record<string, unknown>);
    } catch {
      throw new Error('The database identity check returned an invalid response.');
    }
  }

  async createDump(config: BackupConfig, workDirectory: string, dumpPath: string): Promise<void> {
    if (dumpPath !== join(workDirectory, 'database.dump')) {
      throw new Error('The PostgreSQL dump path is outside the isolated backup workspace.');
    }
    await this.runPostgresTool(workDirectory, 'database dump', [
      'pg_dump',
      '--format=custom',
      '--compress=6',
      '--schema=public',
      '--no-large-objects',
      '--lock-wait-timeout=60s',
      '--no-password',
      '--file=/backup/database.dump',
      '--dbname',
      config.databaseConnectionString,
    ]);
  }

  async validateDump(workDirectory: string, dumpPath: string): Promise<void> {
    if (dumpPath !== join(workDirectory, 'database.dump')) {
      throw new Error('The PostgreSQL dump path is outside the isolated backup workspace.');
    }
    const output = await this.runPostgresTool(workDirectory, 'dump archive validation', [
      'pg_restore',
      '--list',
      '/backup/database.dump',
    ]);
    if (!output.trim().includes('TABLE DATA') && !output.trim().includes('TABLE ')) {
      throw new Error(
        'The PostgreSQL custom archive did not contain an expected public schema entry.',
      );
    }
  }

  async encrypt(dumpPath: string, encryptedPath: string, recipient: string): Promise<void> {
    await runProcess('age', ['--recipient', recipient, '--output', encryptedPath, dumpPath], {
      label: 'backup encryption',
    });
  }

  async fileInfo(filePath: string): Promise<BackupFileInfo> {
    const details = await stat(filePath);
    if (!details.isFile()) throw new Error('A backup artifact was not a regular file.');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return { bytes: details.size, sha256: hash.digest('hex') };
  }

  private async runPostgresTool(
    workDirectory: string,
    label: string,
    command: readonly string[],
  ): Promise<string> {
    const args = createPostgresToolArguments(
      workDirectory,
      command,
      process.getuid?.(),
      process.getgid?.(),
    );
    return runProcess('docker', args, { label });
  }
}

function parseDatabaseIdentity(value: Record<string, unknown>): DatabaseIdentity {
  const booleanFields = [
    'isSuperuser',
    'bypassRls',
    'canCreateDatabase',
    'canCreateRole',
    'canReplicate',
    'canReadAllData',
    'hasPgNet',
    'hasExternalSchemaSelect',
  ] as const;
  if (
    typeof value.currentUser !== 'string' ||
    typeof value.currentDatabase !== 'string' ||
    typeof value.serverVersion !== 'string' ||
    typeof value.serverVersionNum !== 'number' ||
    !Number.isInteger(value.serverVersionNum) ||
    typeof value.defaultTransactionReadOnly !== 'string' ||
    booleanFields.some((field) => typeof value[field] !== 'boolean')
  ) {
    throw new Error('The database identity check returned an invalid response.');
  }
  return value as unknown as DatabaseIdentity;
}

class R2SnapshotStore implements SnapshotStore {
  private readonly client: S3Client;

  constructor(private readonly config: BackupConfig) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    });
  }

  destroy(): void {
    this.client.destroy();
  }

  async uploadAndVerifySnapshot(
    key: string,
    filePath: string,
    info: BackupFileInfo,
  ): Promise<void> {
    await this.safely('snapshot upload', () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.config.r2Bucket,
          Key: key,
          Body: createReadStream(filePath),
          ContentLength: info.bytes,
          ContentType: 'application/octet-stream',
          Metadata: { backupversion: '1', sha256: info.sha256 },
        }),
      ),
    );

    const head = await this.safely('snapshot HEAD verification', () =>
      this.client.send(new HeadObjectCommand({ Bucket: this.config.r2Bucket, Key: key })),
    );
    if (head.ContentLength !== info.bytes || head.Metadata?.sha256 !== info.sha256) {
      throw new Error('The uploaded snapshot metadata did not match the local artifact.');
    }

    const remote = await this.readObjectHash(key, 'snapshot read-back verification');
    if (remote.bytes !== info.bytes || remote.sha256 !== info.sha256) {
      throw new Error('The uploaded snapshot failed its read-back checksum.');
    }
  }

  async uploadAndVerifyManifest(key: string, body: Buffer): Promise<void> {
    if (body.byteLength > MANIFEST_MAX_BYTES) {
      throw new Error('Snapshot manifest exceeds the supported size.');
    }
    const hash = createHash('sha256').update(body).digest('hex');
    await this.safely('manifest upload', () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.config.r2Bucket,
          Key: key,
          Body: body,
          ContentLength: body.byteLength,
          ContentType: 'application/json',
          Metadata: { manifestversion: '1', sha256: hash },
        }),
      ),
    );

    const head = await this.safely('manifest HEAD verification', () =>
      this.client.send(new HeadObjectCommand({ Bucket: this.config.r2Bucket, Key: key })),
    );
    if (head.ContentLength !== body.byteLength || head.Metadata?.sha256 !== hash) {
      throw new Error('The uploaded manifest metadata did not match the local manifest.');
    }
    const remote = await this.readObjectBytes(
      key,
      MANIFEST_MAX_BYTES,
      'manifest read-back verification',
    );
    if (!remote.equals(body)) throw new Error('The uploaded manifest failed its read-back check.');
  }

  async listVerifiedSnapshots(): Promise<readonly SnapshotManifest[]> {
    const keys = await this.listKeys();
    const snapshots = new Set(keys.filter((key) => key.endsWith('.dump.age')));
    const manifests = keys.filter((key) => key.endsWith('.dump.age.manifest.json'));
    if (snapshots.size + manifests.length !== keys.length) {
      throw new Error('Unexpected objects exist in the database-backup snapshot prefix.');
    }

    const manifestKeys = new Set(manifests);
    for (const snapshotKey of snapshots) {
      if (!manifestKeys.has(manifestKeyForSnapshot(snapshotKey))) {
        throw new Error('An incomplete snapshot object exists; retention was stopped.');
      }
    }

    const result: SnapshotManifest[] = [];
    for (const key of manifests) {
      const body = await this.readObjectBytes(key, MANIFEST_MAX_BYTES, 'manifest download');
      const manifest = parseSnapshotManifest(JSON.parse(body.toString('utf8')) as unknown);
      if (
        manifestKeyForSnapshot(manifest.snapshotKey) !== key ||
        !snapshots.has(manifest.snapshotKey)
      ) {
        throw new Error('A snapshot manifest does not match its object key.');
      }
      const manifestHash = createHash('sha256').update(body).digest('hex');
      const manifestHead = await this.safely('manifest metadata check', () =>
        this.client.send(new HeadObjectCommand({ Bucket: this.config.r2Bucket, Key: key })),
      );
      if (
        manifestHead.ContentLength !== body.byteLength ||
        manifestHead.Metadata?.sha256 !== manifestHash ||
        manifestHead.Metadata?.manifestversion !== '1'
      ) {
        throw new Error('A stored snapshot manifest failed its checksum metadata check.');
      }

      const snapshotHead = await this.safely('snapshot metadata check', () =>
        this.client.send(
          new HeadObjectCommand({ Bucket: this.config.r2Bucket, Key: manifest.snapshotKey }),
        ),
      );
      if (
        snapshotHead.ContentLength !== manifest.encryptedBytes ||
        snapshotHead.Metadata?.sha256 !== manifest.encryptedSha256 ||
        snapshotHead.Metadata?.backupversion !== '1'
      ) {
        throw new Error('A stored snapshot failed its checksum metadata check.');
      }
      result.push(manifest);
    }

    if (snapshots.size !== result.length) {
      throw new Error('The snapshot prefix contains unmatched objects; retention was stopped.');
    }
    return result;
  }

  async deleteObject(key: string): Promise<void> {
    if (!key.startsWith(SNAPSHOT_PREFIX)) {
      throw new Error('Refusing to delete an object outside the database-backup snapshot prefix.');
    }
    await this.safely('snapshot retention delete', () =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.config.r2Bucket, Key: key })),
    );
  }

  private async listKeys(): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.safely('snapshot listing', () =>
        this.client.send(
          new ListObjectsV2Command({
            Bucket: this.config.r2Bucket,
            Prefix: SNAPSHOT_PREFIX,
            ContinuationToken: continuationToken,
          }),
        ),
      );
      for (const item of response.Contents ?? []) {
        if (item.Key) keys.push(item.Key);
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      if (response.IsTruncated && !continuationToken) {
        throw new Error('R2 returned a truncated listing without a continuation token.');
      }
    } while (continuationToken);
    return keys;
  }

  private async readObjectHash(key: string, operation: string): Promise<BackupFileInfo> {
    const response = await this.safely(operation, () =>
      this.client.send(new GetObjectCommand({ Bucket: this.config.r2Bucket, Key: key })),
    );
    if (!response.Body) throw new Error(`R2 ${operation} returned no object body.`);
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.Body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      bytes += chunk.byteLength;
    }
    return { bytes, sha256: hash.digest('hex') };
  }

  private async readObjectBytes(key: string, maxBytes: number, operation: string): Promise<Buffer> {
    const response = await this.safely(operation, () =>
      this.client.send(new GetObjectCommand({ Bucket: this.config.r2Bucket, Key: key })),
    );
    if (!response.Body) throw new Error(`R2 ${operation} returned no object body.`);
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response.Body as unknown as AsyncIterable<Uint8Array>) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxBytes) throw new Error(`R2 ${operation} exceeded the supported object size.`);
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, bytes);
  }

  private async safely<T>(operation: string, request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'unknown';
      throw new Error(`R2 ${operation} failed (${errorName}).`);
    }
  }
}

async function runProcess(
  executable: string,
  args: readonly string[],
  options: { label: string },
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, [...args], {
      shell: false,
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        LC_ALL: 'C',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = appendTail(stdout, chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = appendTail(stderr, chunk);
    });
    child.on('error', () => {
      rejectPromise(new Error(`${options.label} could not start.`));
    });
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolvePromise(stdout);
        return;
      }
      const diagnostic = sanitizeDiagnostic(stderr);
      rejectPromise(
        new Error(
          `${options.label} failed with exit code ${String(exitCode)}.${diagnostic ? ` ${diagnostic}` : ''}`,
        ),
      );
    });
  });
}

function appendTail(current: string, chunk: string): string {
  return `${current}${chunk}`.slice(-PROCESS_OUTPUT_MAX_CHARS);
}

function sanitizeDiagnostic(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[connection URL redacted]')
    .replace(/password\s*[=:]\s*[^\s,;]+/gi, 'password=[redacted]')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(-2000);
}

async function writePgpassFile(config: BackupConfig, workDirectory: string): Promise<void> {
  const filePath = join(workDirectory, 'pgpass');
  await writeFile(filePath, `${config.pgpassEntry}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(filePath, 0o600);
}

async function createWorkDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'drezivo-db-backup-'));
  await chmod(directory, 0o700);
  return directory;
}

async function main(): Promise<void> {
  if (process.platform !== 'linux') {
    throw new Error('Database backups must run on the isolated GitHub-hosted Linux runner.');
  }
  const config = resolveBackupConfig(process.env);
  const workDirectory = await createWorkDirectory();
  const store = new R2SnapshotStore(config);
  try {
    await writePgpassFile(config, workDirectory);
    const tools = new SystemBackupTools();
    console.info('Starting encrypted production database backup.');
    const result = await createDatabaseBackup(config, tools, store, workDirectory);
    console.info(
      `Verified snapshot ${result.snapshotKey} (${result.encryptedBytes} bytes); removed ${result.removedSnapshots} older snapshot(s).`,
    );
  } finally {
    store.destroy();
    await rm(workDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown backup failure.';
    console.error(`Production database backup failed: ${message}`);
    process.exitCode = 1;
  });
}

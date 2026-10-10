export type RemoteMigrationConnectionMode = 'direct' | 'session-pooler';

const directHostPattern = /^db\.[a-z0-9-]+\.supabase\.co$/;
const sessionPoolerHostSuffix = '.pooler.supabase.com';

export function classifyRemoteMigrationConnection(
  connectionString: string,
): RemoteMigrationConnectionMode {
  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Remote migration URL must be a valid PostgreSQL connection URL.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('Remote migration URL must use the PostgreSQL protocol.');
  }

  if (!url.username || !url.password || url.pathname.length <= 1) {
    throw new Error('Remote migration URL must include database credentials and a database name.');
  }

  const hostname = url.hostname.toLowerCase();
  const isSessionPooler = hostname.endsWith(sessionPoolerHostSuffix);
  const isDirectConnection = directHostPattern.test(hostname);
  const port = url.port || '5432';

  if (isSessionPooler && port === '6543') {
    throw new Error(
      'Supavisor transaction pooling is not supported for migrations; use Session mode on port 5432.',
    );
  }

  if (port !== '5432') {
    throw new Error('Remote Supabase migrations require a connection on port 5432.');
  }

  if (isSessionPooler) return 'session-pooler';
  if (isDirectConnection) return 'direct';

  throw new Error(
    'Remote migrations require a Supabase direct connection or shared Session pooler URL.',
  );
}

export function resolveMigrationDatabaseUrl(options: {
  isRemoteEnvironment: boolean;
  migrationUrl?: string | undefined;
  directUrl?: string | undefined;
  databaseUrl?: string | undefined;
}): string {
  const { isRemoteEnvironment, migrationUrl, directUrl, databaseUrl } = options;
  const selectedUrl = isRemoteEnvironment ? migrationUrl : (directUrl ?? databaseUrl);

  if (!selectedUrl) {
    throw new Error(
      isRemoteEnvironment
        ? 'DATABASE_URL_MIGRATION is required for staging and production migrations.'
        : 'DATABASE_URL_DIRECT or DATABASE_URL is required to run migrations.',
    );
  }

  if (isRemoteEnvironment) classifyRemoteMigrationConnection(selectedUrl);
  return selectedUrl;
}

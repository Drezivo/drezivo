import { describe, expect, it } from 'vitest';

import {
  classifyRemoteMigrationConnection,
  resolveMigrationDatabaseUrl,
} from '../../scripts/migration-connection.js';

describe('classifyRemoteMigrationConnection', () => {
  it('accepts a Supabase direct connection on the PostgreSQL port', () => {
    expect(
      classifyRemoteMigrationConnection(
        'postgresql://postgres:secret@db.sampleproject.supabase.co:5432/postgres',
      ),
    ).toBe('direct');
  });

  it('accepts the shared Session pooler on port 5432', () => {
    expect(
      classifyRemoteMigrationConnection(
        'postgresql://postgres.sampleproject:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
      ),
    ).toBe('session-pooler');
  });

  it('rejects the Supavisor transaction pooler on port 6543', () => {
    expect(() =>
      classifyRemoteMigrationConnection(
        'postgresql://postgres.sampleproject:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
      ),
    ).toThrow(/transaction pooling is not supported/);
  });

  it('rejects unsupported ports, hosts, and protocols', () => {
    expect(() =>
      classifyRemoteMigrationConnection(
        'postgresql://postgres:secret@db.sampleproject.supabase.co:6432/postgres',
      ),
    ).toThrow(/require a connection on port 5432/);
    expect(() =>
      classifyRemoteMigrationConnection(
        'postgresql://postgres:secret@db.example.com:5432/postgres',
      ),
    ).toThrow(/Supabase direct connection or shared Session pooler/);
    expect(() =>
      classifyRemoteMigrationConnection('https://db.sampleproject.supabase.co:5432'),
    ).toThrow(/PostgreSQL protocol/);
    expect(() =>
      classifyRemoteMigrationConnection('postgresql://db.sampleproject.supabase.co:5432/postgres'),
    ).toThrow(/credentials and a database name/);
    expect(() => classifyRemoteMigrationConnection('not-a-url')).toThrow(/valid PostgreSQL/);
  });
});

describe('resolveMigrationDatabaseUrl', () => {
  it('requires and validates the dedicated migration URL remotely', () => {
    expect(() =>
      resolveMigrationDatabaseUrl({
        isRemoteEnvironment: true,
        directUrl: 'postgresql://postgres:secret@db.sampleproject.supabase.co:5432/postgres',
        databaseUrl: 'postgresql://db.example.com:5432/postgres',
      }),
    ).toThrow(/DATABASE_URL_MIGRATION is required/);

    expect(
      resolveMigrationDatabaseUrl({
        isRemoteEnvironment: true,
        migrationUrl:
          'postgresql://postgres.sampleproject:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
        databaseUrl: 'postgresql://db.example.com:5432/postgres',
      }),
    ).toBe(
      'postgresql://postgres.sampleproject:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    );
  });

  it('retains direct and runtime URL fallbacks only for local migrations', () => {
    expect(
      resolveMigrationDatabaseUrl({
        isRemoteEnvironment: false,
        directUrl: 'postgresql://localhost:5432/drezivo',
        databaseUrl: 'postgresql://localhost:5432/other',
      }),
    ).toBe('postgresql://localhost:5432/drezivo');
    expect(
      resolveMigrationDatabaseUrl({
        isRemoteEnvironment: false,
        databaseUrl: 'postgresql://localhost:5432/other',
      }),
    ).toBe('postgresql://localhost:5432/other');
  });
});

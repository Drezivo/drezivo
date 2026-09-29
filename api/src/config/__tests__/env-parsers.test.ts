import { describe, expect, it } from 'vitest';

import { strictBooleanEnv } from '../env-parsers.js';

describe('strictBooleanEnv', () => {
  it('parses textual true and false values by meaning', () => {
    const schema = strictBooleanEnv('WORKER_ENABLED');

    expect(schema.parse('true')).toBe(true);
    expect(schema.parse(' TRUE ')).toBe(true);
    expect(schema.parse('false')).toBe(false);
    expect(schema.parse(' False ')).toBe(false);
  });

  it('uses the configured default when the variable is absent', () => {
    expect(strictBooleanEnv('WORKER_ENABLED').default(false).parse(undefined)).toBe(false);
    expect(strictBooleanEnv('S3_FORCE_PATH_STYLE').default(true).parse(undefined)).toBe(true);
  });

  it('rejects ambiguous boolean values', () => {
    const schema = strictBooleanEnv('WORKER_ENABLED');

    expect(() => schema.parse('1')).toThrow('WORKER_ENABLED must be true or false');
    expect(() => schema.parse('yes')).toThrow('WORKER_ENABLED must be true or false');
    expect(() => schema.parse('')).toThrow('WORKER_ENABLED must be true or false');
  });
});

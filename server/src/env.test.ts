import { readEnv } from './env.js';

const base = { DATABASE_URL: 'mysql://u:p@localhost/db' };

describe('readEnv', () => {
  test('an unset NODE_ENV is production: Secure cookies and one trusted proxy', () => {
    expect(readEnv(base)).toMatchObject({ nodeEnv: 'production', secureCookies: true, trustProxy: 1 });
    expect(readEnv({ ...base, NODE_ENV: '' })).toMatchObject({ nodeEnv: 'production', secureCookies: true, trustProxy: 1 });
  });

  test('only NODE_ENV development or test turns Secure cookies and proxy trust off', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(readEnv({ ...base, NODE_ENV })).toMatchObject({ nodeEnv: NODE_ENV, secureCookies: false, trustProxy: 0 });
    }
    for (const NODE_ENV of ['production', 'staging', 'Development', 'dev']) {
      expect(readEnv({ ...base, NODE_ENV })).toMatchObject({ secureCookies: true, trustProxy: 1 });
    }
  });

  test('TRUST_PROXY sets the hop count in either mode', () => {
    expect(readEnv({ ...base, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(readEnv({ ...base, TRUST_PROXY: '0' }).trustProxy).toBe(0);
    expect(readEnv({ ...base, NODE_ENV: 'development', TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(readEnv({ ...base, TRUST_PROXY: '' }).trustProxy).toBe(1); // empty is unset
  });

  test('a TRUST_PROXY that is not a whole number of hops is rejected by name', () => {
    for (const TRUST_PROXY of ['abc', 'true', '-1', '1.5', '1e3', ' ', '1 2', 'loopback']) {
      expect(() => readEnv({ ...base, TRUST_PROXY }), TRUST_PROXY).toThrow(/TRUST_PROXY must be a whole number/);
    }
  });

  test('DATABASE_URL is required', () => {
    expect(() => readEnv({})).toThrow('DATABASE_URL is required');
  });
});

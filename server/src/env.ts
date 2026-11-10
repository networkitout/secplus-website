import { existsSync } from 'node:fs';

export interface Env {
  port: number;
  /** `NODE_ENV`, or `production` when it is unset. */
  nodeEnv: string;
  /** Session cookies carry `Secure`. On unless `NODE_ENV` is `development` or `test`. */
  secureCookies: boolean;
  /** Reverse proxies in front of the app whose `X-Forwarded-For` entry is trusted (Express `trust proxy`). */
  trustProxy: number;
  databaseUrl: string;
  adminLogin?: string;
  adminPassword?: string;
  adminName?: string;
}

/** Loads `.env` from the working directory for local development, if present. Never overrides real variables. */
export function loadDotEnv(file = '.env'): void {
  if (existsSync(file)) process.loadEnvFile(file);
}

/** The only `NODE_ENV` values that turn the production defaults off; anything else, or nothing, is production. */
const DEVELOPMENT_ENVS = new Set(['development', 'test']);

function readTrustProxy(raw: string | undefined, production: boolean): number {
  if (raw === undefined || raw === '') return production ? 1 : 0;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`TRUST_PROXY must be a whole number of reverse proxies in front of the app (0 or more), got "${raw}"`);
  }
  return Number(raw);
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const port = Number(source.PORT ?? 3000);
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const nodeEnv = source.NODE_ENV || 'production';
  const production = !DEVELOPMENT_ENVS.has(nodeEnv);
  return {
    port: Number.isInteger(port) && port > 0 ? port : 3000,
    nodeEnv,
    secureCookies: production,
    trustProxy: readTrustProxy(source.TRUST_PROXY, production),
    databaseUrl,
    adminLogin: source.ADMIN_LOGIN || undefined,
    adminPassword: source.ADMIN_PASSWORD || undefined,
    adminName: source.ADMIN_NAME || undefined,
  };
}

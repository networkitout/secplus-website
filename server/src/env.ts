import { existsSync } from 'node:fs';

export interface Env {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
}

/** Loads `.env` from the working directory for local development, if present. Never overrides real variables. */
export function loadDotEnv(file = '.env'): void {
  if (existsSync(file)) process.loadEnvFile(file);
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const port = Number(source.PORT ?? 3000);
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return {
    port: Number.isInteger(port) && port > 0 ? port : 3000,
    nodeEnv: source.NODE_ENV || 'development',
    databaseUrl,
  };
}

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import type { Content } from './content/loader.js';
import type { Db } from './db/db.js';

export type AppDeps = {
  db: Db;
  content: Content;
  now: () => Date;
  clientDir?: string;
  secureCookies: boolean;
};

const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
]);

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (deps.clientDir) {
    const clientDir = path.resolve(deps.clientDir);
    app.use(express.static(clientDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.sendFile(path.join(clientDir, 'index.html'), (err) => {
        if (err) next(err);
      });
    });
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      return res.status(err.status === 413 ? 413 : 400).json({ error: 'Bad request' });
    }
    if (DB_UNAVAILABLE_CODES.has(err?.code)) {
      return res.status(503).json({ error: 'Service unavailable' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}

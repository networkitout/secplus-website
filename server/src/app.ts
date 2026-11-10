import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import helmet from 'helmet';
import type { Content } from './content/loader.js';
import type { Db } from './db/db.js';
import { adminRouter } from './features/admin/routes.js';
import { assessmentsRouter } from './features/assessments/routes.js';
import { authRouter } from './features/auth/routes.js';
import { answersRouter } from './features/answers/routes.js';
import { dashboardRouter, pathRouter, practiceRouter } from './features/dashboard/routes.js';
import { leaderboardRouter } from './features/leaderboard/routes.js';
import { lessonsRouter } from './features/lessons/routes.js';
import { reviewRouter } from './features/review/routes.js';
import { settingsRouter } from './features/settings/routes.js';
import { HttpError, requireCsrfHeader } from './http.js';

export type AppDeps = {
  db: Db;
  content: Content;
  now: () => Date;
  clientDir?: string;
  secureCookies: boolean;
  /** bcrypt cost for new passwords; defaults to 12 (tests lower it). */
  bcryptCost?: number;
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
  app.locals.deps = deps;
  if (deps.secureCookies) app.set('trust proxy', 1); // production sits behind Hostinger's proxy
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'script-src': ["'self'"],
          'frame-ancestors': ["'none'"],
        },
      },
    }),
  );
  app.use('/api', requireCsrfHeader);
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter(deps));
  app.use('/api/admin', adminRouter(deps));
  app.use('/api/review', reviewRouter(deps));
  app.use('/api/lessons', lessonsRouter(deps));
  app.use('/api/answers', answersRouter(deps));
  app.use('/api/assessments', assessmentsRouter(deps));
  app.use('/api/path', pathRouter(deps));
  app.use('/api/dashboard', dashboardRouter(deps));
  app.use('/api/practice', practiceRouter(deps));
  app.use('/api/settings', settingsRouter(deps));
  app.use('/api/leaderboard', leaderboardRouter(deps));

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
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
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

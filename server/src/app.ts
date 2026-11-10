import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import helmet from 'helmet';
import type { Content } from './content/loader.js';
import { isDbUnavailable, type Db } from './db/db.js';
import { adminRouter } from './features/admin/routes.js';
import { assessmentsRouter } from './features/assessments/routes.js';
import { authRouter } from './features/auth/routes.js';
import { answersRouter } from './features/answers/routes.js';
import { dashboardRouter, pathRouter, practiceRouter } from './features/dashboard/routes.js';
import { labsRouter } from './features/labs/routes.js';
import { leaderboardRouter } from './features/leaderboard/routes.js';
import { lessonsRouter } from './features/lessons/routes.js';
import { reviewRouter } from './features/review/routes.js';
import { settingsRouter } from './features/settings/routes.js';
import { HttpError, requireCsrfHeader } from './http.js';
import { errorLine, logError } from './log.js';

export type AppDeps = {
  db: Db;
  content: Content;
  now: () => Date;
  clientDir?: string;
  secureCookies: boolean;
  /** Reverse proxies in front of the app (Express `trust proxy` hop count): whose `X-Forwarded-For` entry gives `req.ip`. */
  trustProxy: number;
  /** bcrypt cost for new passwords; defaults to 12 (tests lower it). */
  bcryptCost?: number;
};

/** The 4xx status of an error Express or a body parser raised for a request it could not read, if it has one. */
function clientErrorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500 ? status : undefined;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.locals.deps = deps;
  app.set('trust proxy', deps.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          // Style sheets come from the build only: the client adds no <style> elements. Its inline styles
          // (Motion, dnd-kit, the progress bars) are set from script, which the policy leaves alone;
          // `style-src-attr` lets a `style` attribute written in markup apply as well, and nothing more.
          'style-src': ["'self'"],
          'style-src-attr': ["'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'script-src': ["'self'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
        },
      },
    }),
  );
  // API answers are personal and change with every request: no browser or proxy may keep one.
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
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
  app.use('/api/labs', labsRouter(deps));
  app.use('/api/leaderboard', leaderboardRouter(deps));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (deps.clientDir) {
    const clientDir = path.resolve(deps.clientDir);
    // A build's hashed files: the name changes whenever the content does, so a copy can be kept for good.
    app.use('/assets', express.static(path.join(clientDir, 'assets'), { immutable: true, maxAge: '365d', index: false }));
    // One that is gone must not answer with the app shell.
    app.use('/assets', (_req, res) => {
      res.status(404).type('text/plain').send('Not found');
    });
    // The app shell names the current hashed files, so a browser must ask for it again on every load.
    app.use(
      express.static(clientDir, {
        setHeaders(res, file) {
          if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.set('Cache-Control', 'no-cache');
      // Sent relative to its directory: given one absolute path, `send` refuses it when any directory above
      // the build starts with a dot (a home directory's `.local`, say).
      res.sendFile('index.html', { root: clientDir }, (err) => {
        // The shell is part of the build: failing to send it is a server fault, whatever status the file error carries.
        if (err) next(new Error(`Cannot send ${path.join(clientDir, 'index.html')}: ${err.message}`, { cause: err }));
      });
    });
  }

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    // Malformed JSON, a body that is too large, a bad percent-escape in the path: the request's fault, not ours.
    const clientError = clientErrorStatus(err);
    if (clientError) return res.status(clientError).json({ error: 'Bad request' });
    if (isDbUnavailable(err)) {
      console.error(`Database unavailable: ${errorLine(err)}`);
      return res.status(503).json({ error: 'Service unavailable' });
    }
    logError(err);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}

import express, { type Express } from 'express';
import path from 'node:path';

export interface AppDeps {
  clientDir?: string;
}

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

  return app;
}

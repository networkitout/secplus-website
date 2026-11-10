import path from 'node:path';
import { createApp } from './app.js';
import { readEnv } from './env.js';

const env = readEnv();
const app = createApp({ clientDir: path.resolve(process.cwd(), 'dist/client') });

app.listen(env.port, () => {
  console.log(`Listening on port ${env.port}`);
});

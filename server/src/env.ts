export interface Env {
  port: number;
  nodeEnv: string;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const port = Number(source.PORT ?? 3000);
  return {
    port: Number.isInteger(port) && port > 0 ? port : 3000,
    nodeEnv: source.NODE_ENV || 'development',
  };
}

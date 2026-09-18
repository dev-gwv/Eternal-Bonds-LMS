import { app } from './app.ts';
import { EnvSchema } from './env.ts';

// The one place that reads process.env. Everything else takes `c.env`.
const env = EnvSchema.parse(process.env);

Bun.serve({
  port: env.PORT,
  fetch: (req) => app.fetch(req, env),
});

console.log(`ipc-api listening on http://localhost:${env.PORT}`);

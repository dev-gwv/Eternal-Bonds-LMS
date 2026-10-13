import { app } from './app.ts';
import { ConfigError, parseEnv, type Env } from './env.ts';

// The one place that reads process.env. Everything else takes `c.env`.
// Bad config stops the process here with the names of the offending keys —
// never their values — rather than serving a half-configured API.
function loadEnv(): Env {
  try {
    return parseEnv(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`ipc-api refused to start — ${error.message}`);
    process.exit(1);
  }
}

const env = loadEnv();

Bun.serve({
  port: env.PORT,
  fetch: (req) => app.fetch(req, env),
});

console.log(`ipc-api listening on http://localhost:${env.PORT}`);

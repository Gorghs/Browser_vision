import 'dotenv/config';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';
import { createLogger, describeError } from './lib/logger.js';
import { createRepositories } from './repositories/index.js';

/**
 * Process entry point.
 *
 * Everything interesting lives in `createApp`; this file only turns the
 * environment into a running server and fails loudly when it cannot.
 */
function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (cause) {
    if (cause instanceof ConfigError) {
      process.stderr.write(`${cause.message}\n`);
      process.exit(1);
    }
    throw cause;
  }

  const logger = createLogger({ level: config.logLevel });
  const repositories = createRepositories(config, logger);
  const app = createApp({ config, repositories, logger });

  const server = app.listen(config.port, () => {
    logger.info('Server listening', { port: config.port, env: config.nodeEnv });
  });

  const shutdown = (signal: string): void => {
    logger.info('Shutting down', { signal });
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // An unhandled rejection means a code path lost its error. Log it rather than
  // let Node terminate on a failure nobody can diagnose.
  process.on('unhandledRejection', (cause) => {
    logger.error('Unhandled promise rejection', describeError(cause));
  });
}

main();

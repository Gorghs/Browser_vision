import 'dotenv/config';
import { createAIService } from './ai/index.js';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';
import { createLogger, describeError } from './lib/logger.js';
import { createTesseractEngine } from './ocr/tesseract-engine.js';
import { createPersistence } from './repositories/index.js';
import { AnalysisWorker } from './services/analysis-worker.js';
import { TimelineService } from './services/timeline.service.js';

/**
 * Process entry point.
 *
 * Everything interesting lives in `createApp` and `AnalysisWorker`; this file
 * only turns the environment into a running server and fails loudly when it
 * cannot.
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
  const persistence = createPersistence(config, logger);
  const app = createApp({ config, persistence, logger });

  const worker = new AnalysisWorker({
    repositories: persistence.repositories,
    visual: persistence.visual,
    store: persistence.store,
    ai: createAIService(config, logger),
    timeline: new TimelineService(persistence.repositories, persistence.visual),
    logger,
    ocr: config.ocrEnabled ? createTesseractEngine({ logger }) : undefined,
    intervalMs: config.analysisIntervalMs,
  });
  worker.start();

  const server = app.listen(config.port, () => {
    logger.info('Server listening', { port: config.port, env: config.nodeEnv });
  });

  const shutdown = (signal: string): void => {
    logger.info('Shutting down', { signal });
    // The OCR worker holds a child process; leaving it running would keep the
    // process alive after the HTTP server has closed.
    void worker.stop().finally(() => {
      server.close(() => process.exit(0));
    });
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

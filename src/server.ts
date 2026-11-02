import { createApp } from './app';
import config from './config';
import { connectDatabase, disconnectDatabase } from './config/database';
import { createDependencies } from './container';
import { startWorkerRuntime, WorkerRuntime } from './workerRuntime';

async function bootstrap() {
  await connectDatabase(config.MONGODB_URI);
  const deps = createDependencies();
  const server = createApp(deps).listen(config.PORT, () => {
    console.log(`Server listening on port ${config.PORT}`);
  });
  const worker: WorkerRuntime | undefined = config.EMBEDDED_WORKER ? startWorkerRuntime(deps) : undefined;

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close(async () => {
      await worker?.stop();
      await deps.jobDispatcher.close();
      await disconnectDatabase();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});

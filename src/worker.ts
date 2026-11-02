import config from './config';
import { connectDatabase, disconnectDatabase } from './config/database';
import { createDependencies } from './container';
import { startWorkerRuntime } from './workerRuntime';

async function bootstrap() {
  await connectDatabase(config.MONGODB_URI);
  const deps = createDependencies();
  const runtime = startWorkerRuntime(deps);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await runtime.stop();
    await deps.jobDispatcher.close();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('Failed to start worker', err);
  process.exit(1);
});

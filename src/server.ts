import { createApp } from './app';
import config from './config';
import { connectDatabase, disconnectDatabase } from './config/database';

async function bootstrap() {
  await connectDatabase(config.MONGODB_URI);
  const server = createApp().listen(config.PORT, () => {
    console.log(`Server listening on port ${config.PORT}`);
  });

  const shutdown = () => {
    server.close(async () => {
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

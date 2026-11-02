import type { ConnectionOptions } from 'bullmq';
import config from '.';

/** BullMQ connection options. Blocking worker connections require `maxRetriesPerRequest: null`. */
export function redisConnection(url = config.REDIS_URL): ConnectionOptions {
  if (!url) throw new Error('REDIS_URL is required when QUEUE_DRIVER=bullmq');
  return { url, maxRetriesPerRequest: null };
}

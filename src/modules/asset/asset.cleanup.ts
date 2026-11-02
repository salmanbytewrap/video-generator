import { StorageProvider } from '../../storage';
import { AssetRepository } from './asset.repository';

export async function cleanupExpiredAssets(
  assets: AssetRepository,
  storage: StorageProvider,
  now = new Date(),
  batchSize = 100,
): Promise<number> {
  const expired = await assets.findExpired(now, batchSize);
  let removed = 0;
  for (const asset of expired) {
    try {
      await storage.delete(asset.storageKey);
      await assets.delete(asset.id);
      removed += 1;
    } catch (err) {
      console.warn('failed to remove expired asset', { assetId: asset.id, error: (err as Error).message });
    }
  }
  return removed;
}

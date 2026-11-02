import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/database';

export function useInMemoryDatabase() {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await connectDatabase(mongo.getUri());
    await mongoose.connection.syncIndexes();
  });

  afterEach(async () => {
    await Promise.all(
      Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
    );
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongo.stop();
  });
}

import type { Mocked } from 'vitest';
import { UserRepository } from '../../src/modules/user';

export function createMockUserRepository(): Mocked<UserRepository> {
  return {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findByEmail: vi.fn(),
    findCredentialsByEmail: vi.fn(),
  };
}

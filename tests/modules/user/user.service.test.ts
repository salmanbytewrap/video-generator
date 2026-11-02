import type { Mocked } from 'vitest';
import { ZodError } from 'zod';
import { UserRepository } from '../../../src/modules/user';
import { UserService } from '../../../src/modules/user/user.service';
import { ForbiddenError, NotFoundError } from '../../../src/utils/AppError';
import { createMockUserRepository } from '../../support/mockUserRepository';

describe('UserService', () => {
  let repo: Mocked<UserRepository>;
  let service: UserService;
  const user = { id: '1', name: 'Jane', email: 'jane@example.com' };

  beforeEach(() => {
    repo = createMockUserRepository();
    service = new UserService(repo);
  });

  it('listUsers_WhenCalled_ReturnsAllUsers', async () => {
    repo.find.mockResolvedValue([user]);

    await expect(service.listUsers()).resolves.toEqual([user]);
  });

  it('getUser_WithExistingId_ReturnsUser', async () => {
    repo.findOne.mockResolvedValue(user);

    await expect(service.getUser('1')).resolves.toEqual(user);
  });

  it('getUser_WithUnknownId_ThrowsNotFoundError', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.getUser('x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updateUser_ForSelf_TrimsAndUpdates', async () => {
    repo.update.mockResolvedValue({ ...user, name: 'Janet' });

    const result = await service.updateUser('1', '1', { name: ' Janet ' });

    expect(repo.update).toHaveBeenCalledWith('1', { name: 'Janet' });
    expect(result.name).toBe('Janet');
  });

  it('updateUser_ForAnotherUser_ThrowsForbiddenError', async () => {
    await expect(service.updateUser('1', '2', { name: 'X' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('updateUser_WithEmptyName_ThrowsZodError', async () => {
    await expect(service.updateUser('1', '1', { name: '' })).rejects.toBeInstanceOf(ZodError);
  });

  it('updateUser_WhenUserMissing_ThrowsNotFoundError', async () => {
    repo.update.mockResolvedValue(null);

    await expect(service.updateUser('1', '1', { name: 'X' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('deleteUser_ForSelf_Deletes', async () => {
    repo.delete.mockResolvedValue(true);

    await service.deleteUser('1', '1');

    expect(repo.delete).toHaveBeenCalledWith('1');
  });

  it('deleteUser_ForAnotherUser_ThrowsForbiddenError', async () => {
    await expect(service.deleteUser('1', '2')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('deleteUser_WhenUserMissing_ThrowsNotFoundError', async () => {
    repo.delete.mockResolvedValue(false);

    await expect(service.deleteUser('1', '1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

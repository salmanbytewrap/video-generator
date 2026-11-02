import type { Mocked } from 'vitest';
import { ZodError } from 'zod';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { hashPassword } from '../../../src/utils/authUtils';
import { verifyToken } from '../../../src/modules/auth/token';
import { UserRepository } from '../../../src/modules/user';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../../src/utils/AppError';
import { createMockUserRepository } from '../../support/mockUserRepository';

describe('AuthService', () => {
  let repo: Mocked<UserRepository>;
  let service: AuthService;
  const user = { id: '507f1f77bcf86cd799439011', name: 'Jane', email: 'jane@example.com' };
  const password = 'correct-horse';

  beforeEach(() => {
    repo = createMockUserRepository();
    service = new AuthService(repo);
  });

  it('register_WithValidInput_StoresHashedPasswordAndReturnsToken', async () => {
    repo.findByEmail.mockResolvedValue(null);
    repo.create.mockResolvedValue(user);

    const result = await service.register({ name: ' Jane ', email: 'JANE@example.com', password });

    const saved = repo.create.mock.calls[0][0];
    expect(saved).toMatchObject({ name: 'Jane', email: 'jane@example.com' });
    expect(saved.password).not.toBe(password);
    expect(result.user).toEqual(user);
    expect(verifyToken(result.token)).toEqual({ id: user.id, email: user.email });
  });

  it('register_WithDuplicateEmail_ThrowsConflictError', async () => {
    repo.findByEmail.mockResolvedValue(user);

    await expect(
      service.register({ name: 'Jane', email: user.email, password }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('register_WithShortPassword_ThrowsZodError', async () => {
    await expect(
      service.register({ name: 'Jane', email: user.email, password: 'short' }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('login_WithValidCredentials_ReturnsUserWithoutHashAndToken', async () => {
    repo.findCredentialsByEmail.mockResolvedValue({
      ...user,
      passwordHash: await hashPassword(password),
    });

    const result = await service.login({ email: user.email, password });

    expect(result.user).toEqual(user);
    expect(verifyToken(result.token)).toEqual({ id: user.id, email: user.email });
  });

  it('login_WithWrongPassword_ThrowsUnauthorizedError', async () => {
    repo.findCredentialsByEmail.mockResolvedValue({
      ...user,
      passwordHash: await hashPassword(password),
    });

    await expect(service.login({ email: user.email, password: 'wrong-pass' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('login_WithUnknownEmail_ThrowsUnauthorizedError', async () => {
    repo.findCredentialsByEmail.mockResolvedValue(null);

    await expect(service.login({ email: user.email, password })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('getProfile_WithExistingUser_ReturnsUser', async () => {
    repo.findOne.mockResolvedValue(user);

    await expect(service.getProfile(user.id)).resolves.toEqual(user);
  });

  it('getProfile_WithDeletedUser_ThrowsNotFoundError', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.getProfile(user.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

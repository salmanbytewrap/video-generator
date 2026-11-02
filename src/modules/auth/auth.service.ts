import { z } from 'zod';
import { createToken } from './token';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { comparePasswords, hashPassword } from '../../utils/authUtils';
import { User, UserRepository } from '../user';

const email = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  // bcrypt ignores input beyond 72 bytes
  password: z.string().min(8).max(72),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(72),
});

export interface AuthResult {
  user: User;
  token: string;
}

export class AuthService {
  constructor(private readonly users: UserRepository) {}

  async register(input: unknown): Promise<AuthResult> {
    const data = registerSchema.parse(input);
    if (await this.users.findByEmail(data.email)) {
      throw new ConflictError('Email already in use');
    }
    const user = await this.users.create({ ...data, password: await hashPassword(data.password) });
    return { user, token: createToken({ id: user.id, email: user.email }) };
  }

  async login(input: unknown): Promise<AuthResult> {
    const data = loginSchema.parse(input);
    const credentials = await this.users.findCredentialsByEmail(data.email);
    if (!credentials || !(await comparePasswords(data.password, credentials.passwordHash))) {
      throw new UnauthorizedError('Invalid email or password');
    }
    const { passwordHash: _, ...user } = credentials;
    return { user, token: createToken({ id: user.id, email: user.email }) };
  }

  async getProfile(userId: string): Promise<User> {
    const user = await this.users.findOne(userId);
    if (!user) throw new NotFoundError('User not found');
    return user;
  }
}

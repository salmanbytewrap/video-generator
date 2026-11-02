import { z } from 'zod';
import { ForbiddenError, NotFoundError } from '../../utils/AppError';
import { UpdateUserData, User, UserRepository } from './user.repository';

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export class UserService {
  constructor(private readonly users: UserRepository) {}

  listUsers(): Promise<User[]> {
    return this.users.find();
  }

  async getUser(id: string): Promise<User> {
    const user = await this.users.findOne(id);
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  async updateUser(actorId: string, id: string, input: UpdateUserData): Promise<User> {
    this.assertSelf(actorId, id);
    const user = await this.users.update(id, updateUserSchema.parse(input));
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  async deleteUser(actorId: string, id: string): Promise<void> {
    this.assertSelf(actorId, id);
    if (!(await this.users.delete(id))) throw new NotFoundError('User not found');
  }

  private assertSelf(actorId: string, id: string): void {
    if (actorId !== id) throw new ForbiddenError('You can only modify your own account');
  }
}

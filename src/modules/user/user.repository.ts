import { BaseRepository, LeanDocument } from '../../repository/baseRepository';
import IRepository from '../../repository/interfaces';
import { UserModel, UserSchema } from './user.model';

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface UserCredentials extends User {
  passwordHash: string;
}

export interface CreateUserData {
  name: string;
  email: string;
  password: string;
}

export interface UpdateUserData {
  name?: string;
}

export interface UserRepository extends IRepository<User, CreateUserData, UpdateUserData> {
  findByEmail(email: string): Promise<User | null>;
  findCredentialsByEmail(email: string): Promise<UserCredentials | null>;
}

export class MongoUserRepository
  extends BaseRepository<UserSchema, User, CreateUserData, UpdateUserData>
  implements UserRepository
{
  constructor() {
    super(UserModel);
  }

  protected toEntity(doc: LeanDocument<UserSchema>): User {
    return { id: String(doc._id), name: doc.name, email: doc.email };
  }

  findByEmail(email: string): Promise<User | null> {
    return this.findOneBy({ email: email.toLowerCase() });
  }

  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const doc = await this._model
      .findOne({ email: email.toLowerCase() })
      .select('+password')
      .lean<LeanDocument<UserSchema>>();
    return doc ? { ...this.toEntity(doc), passwordHash: doc.password } : null;
  }
}

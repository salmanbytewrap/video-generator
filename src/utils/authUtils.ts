import bcrypt from 'bcryptjs';
import config from '../config';

/**
 * Hash a plain password with bcrypt.
 */
export const hashPassword = (password: string): Promise<string> => {
  return bcrypt.hash(password, config.BCRYPT_SALT_ROUNDS);
};

/**
 * Compare provided password with hashed password.
 */
export const comparePasswords = (providedPassword: string, hashedPassword: string): Promise<boolean> => {
  return bcrypt.compare(providedPassword, hashedPassword);
};

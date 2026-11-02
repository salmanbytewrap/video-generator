import jwt, { SignOptions } from 'jsonwebtoken';
import config from '../../config';
import { TokenPayload } from '../../types';

const ALGORITHM = 'HS384';

export const createToken = (payload: TokenPayload): string => {
  return jwt.sign({ email: payload.email }, config.JWT_SECRET, {
    algorithm: ALGORITHM,
    subject: payload.id,
    issuer: config.JWT_ISSUER,
    expiresIn: config.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
};

export const verifyToken = (token: string): TokenPayload | null => {
  try {
    const result = jwt.verify(token, config.JWT_SECRET, {
      algorithms: [ALGORITHM],
      issuer: config.JWT_ISSUER,
    });
    if (typeof result === 'string' || !result.sub) return null;
    return { id: result.sub, email: result.email };
  } catch {
    return null;
  }
};

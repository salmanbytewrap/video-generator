import { NextFunction, Request, Response } from 'express';
import { ResponseError } from '../../utils/response';
import { verifyToken } from './token';

export const TOKEN_HEADER = 'idToken';

export const decodeToken = (req: Request, res: Response, next: NextFunction) => {
  const token = req.header(TOKEN_HEADER);
  if (!token) {
    return res
      .status(401)
      .json(new ResponseError({ message: 'Authorization failed.', error: `'${TOKEN_HEADER}' header is required` }));
  }

  const user = verifyToken(token);
  if (!user) {
    return res
      .status(401)
      .json(new ResponseError({ message: 'Authorization failed.', error: 'Invalid or expired token' }));
  }

  req.user = user;
  next();
};

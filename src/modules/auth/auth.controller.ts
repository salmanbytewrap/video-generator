import { NextFunction, Request, Response } from 'express';
import { ResponseSuccess } from '../../utils/response';
import { AuthService } from './auth.service';

export class AuthController {
  constructor(private readonly service: AuthService) {}

  register = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await this.service.register(req.body);
      res.status(201).json(new ResponseSuccess({ data, message: 'User created successfully' }));
    } catch (err) {
      next(err);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(new ResponseSuccess({ data: await this.service.login(req.body) }));
    } catch (err) {
      next(err);
    }
  };

  me = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(new ResponseSuccess({ data: await this.service.getProfile(req.user!.id) }));
    } catch (err) {
      next(err);
    }
  };
}

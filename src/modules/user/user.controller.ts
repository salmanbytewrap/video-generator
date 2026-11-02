import { NextFunction, Request, Response } from 'express';
import { ResponseSuccess } from '../../utils/response';
import { UserService } from './user.service';

export class UserController {
  constructor(private readonly service: UserService) {}

  list = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(new ResponseSuccess({ data: await this.service.listUsers() }));
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(new ResponseSuccess({ data: await this.service.getUser(req.params.id) }));
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
      const user = await this.service.updateUser(req.user!.id, req.params.id, req.body);
      res.status(200).json(new ResponseSuccess({ data: user, message: 'User updated successfully' }));
    } catch (err) {
      next(err);
    }
  };

  remove = async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
      await this.service.deleteUser(req.user!.id, req.params.id);
      res.status(200).json(new ResponseSuccess({ message: 'User deleted successfully' }));
    } catch (err) {
      next(err);
    }
  };
}

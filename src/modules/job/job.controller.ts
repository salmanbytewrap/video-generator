import { NextFunction, Request, Response } from 'express';
import { ResponseSuccess } from '../../utils/response';
import { JobService } from './job.service';

type IdRequest = Request<{ id: string }>;

export class JobController {
  constructor(private readonly service: JobService) {}

  presets = (_req: Request, res: Response) => {
    res.status(200).json(new ResponseSuccess({ data: this.service.getPresets() }));
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { job, created } = await this.service.createJob(req.user!.id, req.body, req.header('Idempotency-Key'));
      res
        .status(created ? 201 : 200)
        .json(new ResponseSuccess({ data: job, message: created ? 'Job queued' : 'Existing job returned' }));
    } catch (err) {
      next(err);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(new ResponseSuccess({ data: await this.service.listJobs(req.user!.id, req.query) }));
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: IdRequest, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(new ResponseSuccess({ data: await this.service.getJob(req.user!.id, req.params.id) }));
    } catch (err) {
      next(err);
    }
  };

  retry = async (req: IdRequest, res: Response, next: NextFunction) => {
    try {
      const job = await this.service.retryJob(req.user!.id, req.params.id);
      res.status(200).json(new ResponseSuccess({ data: job, message: 'Job re-queued' }));
    } catch (err) {
      next(err);
    }
  };

  cancel = async (req: IdRequest, res: Response, next: NextFunction) => {
    try {
      const job = await this.service.cancelJob(req.user!.id, req.params.id);
      res.status(200).json(new ResponseSuccess({ data: job, message: 'Cancellation requested' }));
    } catch (err) {
      next(err);
    }
  };

  download = async (req: IdRequest, res: Response, next: NextFunction) => {
    try {
      res
        .status(200)
        .json(new ResponseSuccess({ data: await this.service.getOutputUrl(req.user!.id, req.params.id, 'download') }));
    } catch (err) {
      next(err);
    }
  };

  preview = async (req: IdRequest, res: Response, next: NextFunction) => {
    try {
      res
        .status(200)
        .json(new ResponseSuccess({ data: await this.service.getOutputUrl(req.user!.id, req.params.id, 'preview') }));
    } catch (err) {
      next(err);
    }
  };
}

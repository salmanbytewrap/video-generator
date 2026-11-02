import { Router } from 'express';
import { JobController } from './job.controller';
import { createJobRouter, JobRouterOptions } from './job.routes';
import { JobService } from './job.service';

export function createJobModule(service: JobService, options?: JobRouterOptions): Router {
  return createJobRouter(new JobController(service), options);
}

export { MongoJobRepository } from './job.repository';
export type { Job, JobCaption, JobError, JobRepository, JobStatus } from './job.repository';
export { JobService } from './job.service';
export type { JobView } from './job.service';

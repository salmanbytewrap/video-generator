import { Router } from 'express';
import { ResponseError } from '../utils/response';
import { LocalStorage } from './local.storage';

const SAFE_CONTENT_TYPE = /^(video|image)\/[a-z0-9.+-]+$/;

export function createFilesRouter(storage: LocalStorage): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    const { key, expires, name, type, sig } = req.query;
    if (typeof key !== 'string' || typeof sig !== 'string' || typeof expires !== 'string') {
      return res.status(400).json(new ResponseError({ error: 'Bad Request', message: 'Invalid file link' }));
    }
    const params = {
      key,
      expires: Number(expires),
      name: typeof name === 'string' ? name : undefined,
      type: typeof type === 'string' ? type : undefined,
    };
    let filePath: string;
    try {
      filePath = storage.resolvePath(key);
    } catch {
      return res.status(400).json(new ResponseError({ error: 'Bad Request', message: 'Invalid file link' }));
    }
    if (!storage.verify(params, sig)) {
      return res.status(403).json(new ResponseError({ error: 'Forbidden', message: 'Link expired or invalid' }));
    }

    if (params.type && SAFE_CONTENT_TYPE.test(params.type)) res.type(params.type);
    if (params.name) res.attachment(params.name.replace(/[^\w.-]/g, '_'));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath, { dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) {
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? res.status(404).json(new ResponseError({ error: 'Not Found', message: 'File not found' }))
          : next(err);
      }
    });
  });

  return router;
}

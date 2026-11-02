import { NextFunction, Request, Response } from 'express';
import { BadRequestError } from '../../utils/AppError';
import { ResponseSuccess } from '../../utils/response';
import { AssetService } from './asset.service';
import { UrlImportService } from './urlImport.service';

export class AssetController {
  constructor(
    private readonly service: AssetService,
    private readonly urlImport: UrlImportService,
  ) {}

  importUrl = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const asset = await this.urlImport.importFromUrl(req.user!.id, req.body);
      res.status(201).json(new ResponseSuccess({ data: asset, message: 'Media imported successfully' }));
    } catch (err) {
      next(err);
    }
  };

  upload = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new BadRequestError("A file is required in the 'file' field");
      const asset = await this.service.ingestFile({
        userId: req.user!.id,
        tempPath: req.file.path,
        originalName: req.file.originalname,
        size: req.file.size,
        source: 'upload',
      });
      res.status(201).json(new ResponseSuccess({ data: asset, message: 'File uploaded successfully' }));
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(new ResponseSuccess({ data: await this.service.getAsset(req.user!.id, req.params.id) }));
    } catch (err) {
      next(err);
    }
  };
}

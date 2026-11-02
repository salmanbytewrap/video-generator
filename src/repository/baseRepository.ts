import { isValidObjectId, Model, QueryFilter, UpdateQuery } from 'mongoose';
import IRepository from './interfaces';

export type LeanDocument<TSchema> = TSchema & { _id: unknown };

export abstract class BaseRepository<TSchema, TEntity, TCreate, TUpdate = Partial<TCreate>>
  implements IRepository<TEntity, TCreate, TUpdate>
{
  constructor(protected readonly _model: Model<TSchema>) {}

  protected abstract toEntity(doc: LeanDocument<TSchema>): TEntity;

  async find(): Promise<TEntity[]> {
    const docs = await this._model.find().lean<LeanDocument<TSchema>[]>();
    return docs.map((doc) => this.toEntity(doc));
  }

  async findOne(id: string): Promise<TEntity | null> {
    if (!isValidObjectId(id)) return null;
    const doc = await this._model.findById(id).lean<LeanDocument<TSchema>>();
    return doc ? this.toEntity(doc) : null;
  }

  async create(item: TCreate): Promise<TEntity> {
    const record = await new this._model(item).save();
    return this.toEntity(record.toObject() as LeanDocument<TSchema>);
  }

  async update(id: string, item: TUpdate): Promise<TEntity | null> {
    if (!isValidObjectId(id)) return null;
    const doc = await this._model
      .findByIdAndUpdate(id, item as UpdateQuery<TSchema>, {
        returnDocument: 'after',
        runValidators: true,
      })
      .lean<LeanDocument<TSchema>>();
    return doc ? this.toEntity(doc) : null;
  }

  async delete(id: string): Promise<boolean> {
    if (!isValidObjectId(id)) return false;
    const result = await this._model.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  protected async findOneBy(filter: QueryFilter<TSchema>): Promise<TEntity | null> {
    const doc = await this._model.findOne(filter).lean<LeanDocument<TSchema>>();
    return doc ? this.toEntity(doc) : null;
  }
}

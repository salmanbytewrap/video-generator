interface IRepository<TEntity, TCreate, TUpdate = Partial<TCreate>> {
  find(): Promise<TEntity[]>;
  findOne(id: string): Promise<TEntity | null>;
  create(item: TCreate): Promise<TEntity>;
  update(id: string, item: TUpdate): Promise<TEntity | null>;
  delete(id: string): Promise<boolean>;
}

export default IRepository;

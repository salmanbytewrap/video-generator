import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { LocalStorage } from '../../src/storage';
import { makeTempDir } from '../support/media';

describe('LocalStorage', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let storage: LocalStorage;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeTempDir());
    storage = new LocalStorage(`${dir}/root`, 'signing-secret', 60, 'http://host');
  });

  afterEach(() => cleanup());

  it('putFile_ThenDownloadToFile_RoundTripsContent', async () => {
    await writeFile(`${dir}/src.txt`, 'hello');

    await storage.putFile('a/b/file.txt', `${dir}/src.txt`);
    await storage.downloadToFile('a/b/file.txt', `${dir}/copy.txt`);

    expect(await readFile(`${dir}/copy.txt`, 'utf8')).toBe('hello');
  });

  it('delete_RemovesFile_AndIgnoresMissingFiles', async () => {
    await writeFile(`${dir}/src.txt`, 'x');
    await storage.putFile('k.txt', `${dir}/src.txt`);

    await storage.delete('k.txt');
    await storage.delete('k.txt');

    expect(existsSync(storage.resolvePath('k.txt'))).toBe(false);
  });

  it.each(['../escape.txt', 'a/../../b', '/abs/path', 'a//b', ''])('resolvePath_RejectsUnsafeKey_%s', (key) => {
    expect(() => storage.resolvePath(key)).toThrow('Invalid storage key');
  });

  it('getDownloadUrl_ProducesSignatureThatVerifies', async () => {
    const url = new URL(await storage.getDownloadUrl('x/y.mp4', { downloadName: 'y.mp4', contentType: 'video/mp4' }));
    const params = {
      key: url.searchParams.get('key')!,
      expires: Number(url.searchParams.get('expires')),
      name: url.searchParams.get('name') ?? undefined,
      type: url.searchParams.get('type') ?? undefined,
    };

    expect(url.origin + url.pathname).toBe('http://host/api/files');
    expect(storage.verify(params, url.searchParams.get('sig')!)).toBe(true);
    expect(storage.verify({ ...params, key: 'x/other.mp4' }, url.searchParams.get('sig')!)).toBe(false);
    expect(storage.verify({ ...params, name: 'evil.html' }, url.searchParams.get('sig')!)).toBe(false);
  });

  it('verify_WithExpiredLink_ReturnsFalse', async () => {
    const url = new URL(await storage.getDownloadUrl('x.mp4', { expiresInSeconds: -1 }));

    expect(
      storage.verify({ key: 'x.mp4', expires: Number(url.searchParams.get('expires')) }, url.searchParams.get('sig')!),
    ).toBe(false);
  });
});

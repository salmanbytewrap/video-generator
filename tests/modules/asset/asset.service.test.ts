import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import type { Mock, Mocked } from 'vitest';
import { AssetRepository, AssetService } from '../../../src/modules/asset';
import type { ProbeFn } from '../../../src/modules/generation/ffprobe';
import { sanitizeFileName } from '../../../src/modules/asset/asset.service';
import { StorageProvider } from '../../../src/storage';
import { BadRequestError, NotFoundError, UnsupportedMediaTypeError } from '../../../src/utils/AppError';
import { makeTempDir } from '../../support/media';
import { buildAsset, createMockAssetRepository, createMockStorage, USER_ID } from '../../support/mocks';

const MP4_HEADER = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(64)]);
const PNG_HEADER = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

describe('AssetService', () => {
  let repo: Mocked<AssetRepository>;
  let storage: Mocked<StorageProvider>;
  let probe: Mock<ProbeFn>;
  let service: AssetService;
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeTempDir());
    repo = createMockAssetRepository();
    storage = createMockStorage();
    probe = vi.fn<ProbeFn>().mockResolvedValue({ width: 1280, height: 720, durationSeconds: 10, hasAudio: true });
    service = new AssetService(repo, storage, probe, { maxVideoSeconds: 60, ttlDays: 7 });
    repo.create.mockImplementation(async (data) => buildAsset({ ...data, id: 'new-id' }));
  });

  afterEach(() => cleanup());

  async function upload(header: Buffer, originalName = 'clip.mp4') {
    const tempPath = `${dir}/upload`;
    await writeFile(tempPath, header);
    return { tempPath, run: () => service.ingestFile({ userId: USER_ID, tempPath, originalName, size: header.length, source: 'upload' }) };
  }

  it('ingestFile_WithValidVideo_StoresUnderUserPrefixAndDeletesTempFile', async () => {
    const { tempPath, run } = await upload(MP4_HEADER, '../../My Clip!.mp4');

    const view = await run();

    const key = storage.putFile.mock.calls[0][0];
    expect(key).toMatch(new RegExp(`^uploads/${USER_ID}/[\\w-]+\\.mp4$`));
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'video', mimeType: 'video/mp4', originalName: 'My Clip_.mp4', role: 'input', expiresAt: expect.any(Date) }),
    );
    expect(view).toMatchObject({ id: 'new-id', url: expect.stringContaining('https://files.test/') });
    expect(existsSync(tempPath)).toBe(false);
  });

  it('ingestFile_WithImage_SkipsDurationCheck', async () => {
    probe.mockResolvedValue({ width: 800, height: 600, hasAudio: false });
    const { run } = await upload(PNG_HEADER, 'photo.png');

    await run();

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image', mimeType: 'image/png' }));
  });

  it('ingestFile_WithUnsupportedType_Throws415AndDeletesTempFile', async () => {
    const { tempPath, run } = await upload(Buffer.from('%PDF-1.7 not a video'));

    await expect(run()).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
    expect(storage.putFile).not.toHaveBeenCalled();
    expect(existsSync(tempPath)).toBe(false);
  });

  it('ingestFile_WhenProbeFails_ThrowsCorruptFileError', async () => {
    probe.mockRejectedValue(new Error('ffprobe exit 1'));
    const { run } = await upload(MP4_HEADER);

    await expect(run()).rejects.toThrow('may be corrupt');
  });

  it.each([
    ['too long', { width: 1280, height: 720, durationSeconds: 61, hasAudio: true }, 'seconds or shorter'],
    ['unknown duration', { width: 1280, height: 720, hasAudio: true }, 'duration'],
    ['too small', { width: 32, height: 720, durationSeconds: 5, hasAudio: true }, 'Dimensions'],
  ])('ingestFile_WithVideo%s_ThrowsBadRequest', async (_name, metadata, message) => {
    probe.mockResolvedValue(metadata);
    const { run } = await upload(MP4_HEADER);

    const error = await run().catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.message).toContain(message);
    expect(storage.putFile).not.toHaveBeenCalled();
  });

  it('getAsset_ForAnotherUsersAsset_ThrowsNotFound', async () => {
    repo.findOneForUser.mockResolvedValue(null);

    await expect(service.getAsset(USER_ID, 'x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('getAsset_ForOwnAsset_ReturnsViewWithSignedUrl', async () => {
    repo.findOneForUser.mockResolvedValue(buildAsset());

    const view = await service.getAsset(USER_ID, 'x');

    expect(view).toMatchObject({ originalName: 'Cool Sneakers.mp4', url: expect.stringContaining('uploads/') });
    expect(view).not.toHaveProperty('storageKey');
  });

  it('sanitizeFileName_StripsPathsAndUnsafeCharacters', () => {
    expect(sanitizeFileName('/etc/../<script>.mp4')).toBe('_script_.mp4');
    expect(sanitizeFileName('')).toBe('upload');
  });
});

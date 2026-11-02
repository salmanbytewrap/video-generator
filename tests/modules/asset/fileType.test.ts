import { writeFile } from 'fs/promises';
import { detectFileType, detectFileTypeFromPath } from '../../../src/modules/asset/fileType';
import { makeTempDir } from '../../support/media';

const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`, 'latin1')]);

describe('detectFileType', () => {
  it.each([
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    ['webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'), 'image/webp'],
    ['webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]), 'video/webm'],
    ['mp4', ftyp('isom'), 'video/mp4'],
    ['mov', ftyp('qt  '), 'video/quicktime'],
  ])('detectFileType_%s_IsRecognised', (_name, header, mimeType) => {
    expect(detectFileType(header)?.mimeType).toBe(mimeType);
  });

  it.each([
    ['heic', ftyp('heic')],
    ['pdf', Buffer.from('%PDF-1.7')],
    ['html renamed to mp4', Buffer.from('<html><script>')],
    ['empty', Buffer.alloc(0)],
  ])('detectFileType_%s_IsRejected', (_name, header) => {
    expect(detectFileType(header)).toBeNull();
  });

  it('detectFileTypeFromPath_ReadsHeaderFromDisk', async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      await writeFile(`${dir}/clip.bin`, Buffer.concat([ftyp('mp42'), Buffer.alloc(100)]));

      expect(await detectFileTypeFromPath(`${dir}/clip.bin`)).toEqual({
        kind: 'video',
        mimeType: 'video/mp4',
        extension: 'mp4',
      });
    } finally {
      await cleanup();
    }
  });
});

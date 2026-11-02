import { readFile } from 'fs/promises';
import http from 'http';
import { AddressInfo } from 'net';
import { AssetService } from '../../../src/modules/asset';
import { IngestFileInput } from '../../../src/modules/asset/asset.service';
import { UrlImportService } from '../../../src/modules/asset/urlImport.service';
import { USER_ID } from '../../support/mocks';

const IMAGE_BYTES = Buffer.from('fake-image-bytes');

describe('UrlImportService', () => {
  let base: string;
  let server: http.Server;
  let ingested: { input: IngestFileInput; contents: Buffer }[];
  let service: UrlImportService;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const routes: Record<string, () => void> = {
        '/photo.jpg': () => {
          res.writeHead(200, { 'content-type': 'image/jpeg' });
          res.end(IMAGE_BYTES);
        },
        '/product': () => {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(
            '<meta property="og:video" content="/embed"><meta property="og:image" content="/photo.jpg"><meta property="og:title" content="Trail Shoe">',
          );
        },
        '/embed': () => {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<html></html>');
        },
        '/no-media': () => {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<title>Nothing here</title>');
        },
        '/broken-media': () => {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<meta property="og:image" content="/missing.jpg">');
        },
        '/data.json': () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{}');
        },
      };
      const route = routes[req.url ?? ''];
      if (route) route();
      else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    ingested = [];
    const assets = {
      ingestFile: vi.fn(async (input: IngestFileInput) => {
        ingested.push({ input, contents: await readFile(input.tempPath) });
        return { id: 'asset-1' };
      }),
    } as unknown as AssetService;
    service = new UrlImportService(assets, { maxMediaBytes: 1000, allowPrivateNetwork: true });
  });

  it('importFromUrl_WithDirectImageUrl_IngestsTheFile', async () => {
    const result = await service.importFromUrl(USER_ID, { url: `${base}/photo.jpg` });

    expect(result).toEqual({ id: 'asset-1' });
    expect(ingested[0].contents).toEqual(IMAGE_BYTES);
    expect(ingested[0].input).toMatchObject({
      userId: USER_ID,
      originalName: 'photo.jpg',
      size: IMAGE_BYTES.length,
      source: 'url',
      sourceUrl: `${base}/photo.jpg`,
    });
  });

  it('importFromUrl_WithProductPage_SkipsNonMediaCandidatesAndUsesOgImage', async () => {
    await service.importFromUrl(USER_ID, { url: `${base}/product` });

    expect(ingested[0].contents).toEqual(IMAGE_BYTES);
    expect(ingested[0].input).toMatchObject({ title: 'Trail Shoe', sourceUrl: `${base}/product` });
  });

  it('importFromUrl_WithPageWithoutMedia_ThrowsBadRequest', async () => {
    await expect(service.importFromUrl(USER_ID, { url: `${base}/no-media` })).rejects.toThrow(
      'No video or image was found on that page',
    );
  });

  it('importFromUrl_WhenAllCandidatesFail_ThrowsLastError', async () => {
    await expect(service.importFromUrl(USER_ID, { url: `${base}/broken-media` })).rejects.toThrow('HTTP 404');
  });

  it('importFromUrl_WithNonHtmlNonMedia_ThrowsUnsupportedMediaType', async () => {
    await expect(service.importFromUrl(USER_ID, { url: `${base}/data.json` })).rejects.toMatchObject({
      statusCode: 415,
    });
  });

  it('importFromUrl_WithMissingUrl_ThrowsValidationError', async () => {
    await expect(service.importFromUrl(USER_ID, {})).rejects.toThrow();
    expect(ingested).toHaveLength(0);
  });

  it('importFromUrl_WithoutPrivateOverride_BlocksLocalServer', async () => {
    const strict = new UrlImportService({} as AssetService, { maxMediaBytes: 1000 });

    await expect(strict.importFromUrl(USER_ID, { url: `${base}/photo.jpg` })).rejects.toThrow('Only ports 80 and 443');
  });
});

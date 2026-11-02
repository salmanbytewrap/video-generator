import http, { RequestListener } from 'http';
import { AddressInfo } from 'net';
import { isPublicAddress, parsePublicUrl, readText, safeGet } from '../../../src/modules/asset/safeFetch';

async function serve(handler: RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

describe('isPublicAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '224.0.0.1'])(
    'isPublicAddress_WithReservedAddress_%s_ReturnsFalse',
    (address) => {
      expect(isPublicAddress(address)).toBe(false);
    },
  );

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'isPublicAddress_WithPublicAddress_%s_ReturnsTrue',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it('isPublicAddress_WithNonIp_ReturnsFalse', () => {
    expect(isPublicAddress('example.com')).toBe(false);
  });
});

describe('parsePublicUrl', () => {
  it.each([
    ['not a url', 'Invalid URL'],
    ['ftp://example.com/a.mp4', 'Only http and https URLs are allowed'],
    ['file:///etc/passwd', 'Only http and https URLs are allowed'],
    ['https://user:pass@example.com/', 'URLs with credentials are not allowed'],
    ['http://example.com:8080/', 'Only ports 80 and 443 are allowed'],
  ])('parsePublicUrl_With_%s_Throws', (url, message) => {
    expect(() => parsePublicUrl(url)).toThrow(message);
  });

  it('parsePublicUrl_WithHttpsUrl_ReturnsUrl', () => {
    expect(parsePublicUrl('https://example.com/video.mp4').hostname).toBe('example.com');
  });
});

describe('safeGet', () => {
  let server: Awaited<ReturnType<typeof serve>>;

  beforeAll(async () => {
    server = await serve((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('hello');
      } else if (req.url === '/redirect') {
        res.writeHead(302, { location: '/ok' });
        res.end();
      } else if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' });
        res.end();
      } else if (req.url === '/to-file') {
        res.writeHead(302, { location: 'file:///etc/passwd' });
        res.end();
      } else if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '5000' });
        res.end(Buffer.alloc(5000));
      } else if (req.url === '/big-chunked') {
        res.writeHead(200, { 'content-type': 'video/mp4' });
        res.write(Buffer.alloc(3000));
        res.end(Buffer.alloc(3000));
      } else if (req.url === '/slow') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('a');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });

  afterAll(async () => {
    await server.close();
  });

  const opts = { maxBytes: 1000, allowPrivateNetwork: true };

  it('safeGet_ByDefault_RejectsLoopbackHosts', async () => {
    await expect(safeGet(`http://127.0.0.1/ok`, { maxBytes: 1000 })).rejects.toThrow(
      'URL points to a private or reserved network address',
    );
    await expect(safeGet(`http://[::1]/ok`, { maxBytes: 1000 })).rejects.toThrow('private or reserved');
  });

  it('safeGet_ByDefault_RejectsHostnamesResolvingToLoopback', async () => {
    await expect(safeGet('http://localhost/ok', { maxBytes: 1000 })).rejects.toThrow('private or reserved');
  });

  it('safeGet_WithOkResponse_ReturnsContentTypeAndBody', async () => {
    const { head, response, close } = await safeGet(`${server.base}/ok`, opts);
    const body = await readText(response, 1000);
    close();

    expect(head.contentType).toBe('text/plain');
    expect(body).toBe('hello');
  });

  it('safeGet_WithRedirect_FollowsToFinalUrl', async () => {
    const { head, response, close } = await safeGet(`${server.base}/redirect`, opts);
    response.resume();
    close();

    expect(head.url.pathname).toBe('/ok');
  });

  it('safeGet_WithRedirectLoop_Throws', async () => {
    await expect(safeGet(`${server.base}/loop`, opts)).rejects.toThrow('Too many redirects');
  });

  it('safeGet_WithRedirectToForbiddenScheme_IsRevalidatedAndRejected', async () => {
    await expect(safeGet(`${server.base}/to-file`, opts)).rejects.toThrow('Only http and https URLs are allowed');
  });

  it('safeGet_WithErrorStatus_Throws', async () => {
    await expect(safeGet(`${server.base}/missing`, opts)).rejects.toThrow('The URL responded with HTTP 404');
  });

  it('safeGet_WithDeclaredLengthOverLimit_ThrowsPayloadTooLarge', async () => {
    await expect(safeGet(`${server.base}/big`, opts)).rejects.toMatchObject({ statusCode: 413 });
  });

  it('readText_WithStreamOverLimit_ThrowsPayloadTooLarge', async () => {
    const { response, close } = await safeGet(`${server.base}/big-chunked`, opts);

    await expect(readText(response, 1000)).rejects.toMatchObject({ statusCode: 413 });
    close();
  });

  it('safeGet_WhenDeadlinePasses_AbortsTheDownload', async () => {
    const { response, close } = await safeGet(`${server.base}/slow`, { ...opts, timeoutMs: 100 });

    await expect(readText(response, 1000)).rejects.toThrow('Download from the URL was interrupted');
    close();
  });

  it('safeGet_WithUnresolvableHost_Throws', async () => {
    await expect(safeGet('http://does-not-exist.invalid/', { maxBytes: 1000 })).rejects.toThrow(
      'Could not resolve the URL host',
    );
  });
});

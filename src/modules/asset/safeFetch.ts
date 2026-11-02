import { lookup as dnsLookup } from 'dns/promises';
import { createWriteStream } from 'fs';
import http, { IncomingMessage } from 'http';
import https from 'https';
import net, { BlockList, LookupFunction } from 'net';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { BadRequestError, PayloadTooLargeError } from '../../utils/AppError';

const blockedV4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const;

const blockedV6 = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const;

const BLOCK_LIST = new BlockList();
for (const [prefix, bits] of blockedV4) BLOCK_LIST.addSubnet(prefix, bits, 'ipv4');
for (const [prefix, bits] of blockedV6) BLOCK_LIST.addSubnet(prefix, bits, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !BLOCK_LIST.check(address, 'ipv4');
  if (family !== 6) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  return !BLOCK_LIST.check(address, 'ipv6');
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
  /** Only for tests against local servers: skips the private-address and port checks. */
  allowPrivateNetwork?: boolean;
}

export interface FetchedHead {
  url: URL;
  contentType: string;
}

const USER_AGENT = 'ClipforgeBot/1.0 (+media import)';
const ALLOWED_PORTS = new Set(['', '80', '443']);

export function parsePublicUrl(raw: string, allowPrivateNetwork = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BadRequestError('Only http and https URLs are allowed');
  if (url.username || url.password) throw new BadRequestError('URLs with credentials are not allowed');
  if (!allowPrivateNetwork && !ALLOWED_PORTS.has(url.port)) throw new BadRequestError('Only ports 80 and 443 are allowed');
  return url;
}

async function resolveVetted(hostname: string, allowPrivateNetwork: boolean): Promise<{ address: string; family: number }> {
  const host = hostname.replace(/^\[|\]$/g, '');
  let addresses: { address: string; family: number }[];
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIP(host) }];
  } else {
    try {
      addresses = await dnsLookup(host, { all: true, verbatim: true });
    } catch {
      throw new BadRequestError('Could not resolve the URL host');
    }
  }
  if (addresses.length === 0) throw new BadRequestError('Could not resolve the URL host');
  if (!allowPrivateNetwork && addresses.some((a) => !isPublicAddress(a.address))) {
    throw new BadRequestError('URL points to a private or reserved network address');
  }
  return addresses[0];
}

function pinnedLookup(address: string, family: number): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function requestOnce(url: URL, vetted: { address: string; family: number }, options: SafeFetchOptions, signal: AbortSignal) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, {
      headers: { 'user-agent': USER_AGENT, accept: options.accept ?? '*/*' },
      lookup: pinnedLookup(vetted.address, vetted.family),
      signal,
    });
    req.on('response', resolve);
    req.on('error', reject);
  });
}

/**
 * GETs a URL, following redirects, and re-validating every hop. The caller must consume or destroy
 * the returned response; `close()` releases the overall deadline timer.
 */
export async function safeGet(
  raw: string,
  options: SafeFetchOptions,
): Promise<{ head: FetchedHead; response: IncomingMessage; close: () => void }> {
  const allowPrivate = options.allowPrivateNetwork ?? false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const close = () => clearTimeout(timer);

  try {
    let url = parsePublicUrl(raw, allowPrivate);
    for (let hop = 0; ; hop += 1) {
      const vetted = await resolveVetted(url.hostname, allowPrivate);
      let response: IncomingMessage;
      try {
        response = await requestOnce(url, vetted, options, controller.signal);
      } catch {
        throw new BadRequestError(controller.signal.aborted ? 'Timed out fetching the URL' : 'Could not fetch the URL');
      }
      const status = response.statusCode ?? 0;

      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (hop >= (options.maxRedirects ?? 3)) throw new BadRequestError('Too many redirects');
        url = parsePublicUrl(new URL(response.headers.location, url).toString(), allowPrivate);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        throw new BadRequestError(`The URL responded with HTTP ${status}`);
      }
      const length = Number(response.headers['content-length']);
      if (Number.isFinite(length) && length > options.maxBytes) {
        response.destroy();
        throw new PayloadTooLargeError('The linked file is too large');
      }
      const contentType = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      return { head: { url, contentType }, response, close };
    }
  } catch (err) {
    close();
    throw err;
  }
}

function byteLimiter(maxBytes: number) {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, callback) {
      total += chunk.length;
      if (total > maxBytes) callback(new PayloadTooLargeError('The linked file is too large'));
      else callback(null, chunk);
    },
  });
}

async function drain(response: IncomingMessage, destination: NodeJS.WritableStream, maxBytes: number) {
  try {
    await pipeline(response, byteLimiter(maxBytes), destination);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) throw err;
    throw new BadRequestError('Download from the URL was interrupted');
  }
}

export async function readText(response: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  const sink = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  sink.resume();
  await drain(response, sink, maxBytes);
  return Buffer.concat(chunks).toString('utf8');
}

export async function saveToFile(response: IncomingMessage, filePath: string, maxBytes: number): Promise<void> {
  await drain(response, createWriteStream(filePath), maxBytes);
}

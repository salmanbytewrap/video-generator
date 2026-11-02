import { open } from 'fs/promises';

export type AssetKind = 'video' | 'image';

export interface DetectedFileType {
  kind: AssetKind;
  mimeType: string;
  extension: string;
}

const HEADER_BYTES = 32;

function ascii(buf: Buffer, start: number, end: number): string {
  return buf.subarray(start, end).toString('latin1');
}

export function detectFileType(header: Buffer): DetectedFileType | null {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return { kind: 'image', mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: 'image', mimeType: 'image/png', extension: 'png' };
  }
  if (header.length >= 12 && ascii(header, 0, 4) === 'RIFF' && ascii(header, 8, 12) === 'WEBP') {
    return { kind: 'image', mimeType: 'image/webp', extension: 'webp' };
  }
  if (header.length >= 4 && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { kind: 'video', mimeType: 'video/webm', extension: 'webm' };
  }
  if (header.length >= 12 && ascii(header, 4, 8) === 'ftyp') {
    const brand = ascii(header, 8, 12);
    if (brand === 'qt  ') return { kind: 'video', mimeType: 'video/quicktime', extension: 'mov' };
    if (/^(heic|heix|mif1|msf1|avif)$/.test(brand)) return null;
    return { kind: 'video', mimeType: 'video/mp4', extension: 'mp4' };
  }
  return null;
}

export async function detectFileTypeFromPath(filePath: string): Promise<DetectedFileType | null> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    return detectFileType(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

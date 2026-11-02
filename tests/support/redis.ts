import { ChildProcess, execFileSync, spawn } from 'child_process';
import net from 'net';

function redisServerBinary(): string | null {
  try {
    return execFileSync('which', ['redis-server']).toString().trim() || null;
  } catch {
    return null;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForPort(port: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
    if (open) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`redis-server did not start on port ${port}`);
}

/** A throwaway Redis for integration tests: REDIS_TEST_URL if set, otherwise a local redis-server. */
export const redisAvailable = Boolean(process.env.REDIS_TEST_URL || redisServerBinary());

export function useRedisServer(): { url: () => string } {
  let child: ChildProcess | undefined;
  let url = process.env.REDIS_TEST_URL ?? '';

  beforeAll(async () => {
    if (url) return;
    const port = await freePort();
    child = spawn(redisServerBinary()!, ['--port', String(port), '--save', '', '--appendonly', 'no'], {
      stdio: 'ignore',
    });
    await waitForPort(port);
    url = `redis://127.0.0.1:${port}`;
  });

  afterAll(() => {
    child?.kill('SIGTERM');
  });

  return { url: () => url };
}

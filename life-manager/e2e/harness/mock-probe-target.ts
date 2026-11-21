import http from 'node:http';
import net from 'node:net';

export interface MockTcpServerHandle {
  host: string;
  port: number;
  readonly connections: number;
  close: () => Promise<void>;
}

export interface MockHttpServerHandle {
  host: string;
  port: number;
  url: string;
  requests: Array<{
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }>;
  setResponse: (statusCode: number, body?: string, delayMs?: number) => void;
  close: () => Promise<void>;
}

export async function startMockTcpServer(): Promise<MockTcpServerHandle> {
  const host = '127.0.0.1';
  const sockets = new Set<net.Socket>();
  let connectionCount = 0;
  let closed = false;

  const server = net.createServer((socket) => {
    connectionCount += 1;
    sockets.add(socket);
    // Prevent unhandled ECONNRESET when Tokio TCP prober closes immediately after SYN/ACK
    socket.on('error', () => {});
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  server.on('error', () => {});

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.removeListener('error', reject);
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind mock TCP server'));
        return;
      }
      resolve(addr.port);
    });
  });

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const sock of Array.from(sockets)) {
      sock.destroy();
    }
    sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return {
    host,
    port,
    get connections(): number {
      return connectionCount;
    },
    close,
  };
}

export async function startMockHttpServer(
  statusCode = 200,
  body = '{"status":"ok"}',
  delayMs = 0,
): Promise<MockHttpServerHandle> {
  const host = '127.0.0.1';
  let currentStatus = statusCode;
  let currentBody = body;
  let currentDelay = delayMs;
  let closed = false;

  const sockets = new Set<net.Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const requests: Array<{
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }> = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('error', () => {});
    req.on('end', () => {
      requests.push({
        method: req.method || 'GET',
        path: req.url || '/',
        headers: { ...req.headers },
        body: Buffer.concat(chunks).toString('utf8'),
      });

      const respond = () => {
        if (closed || res.writableEnded || res.destroyed) return;
        const trimmed = currentBody.trim();
        const isJson = trimmed.startsWith('{') || trimmed.startsWith('[');
        res.statusCode = currentStatus;
        res.setHeader(
          'Content-Type',
          isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
        );
        res.end(currentBody);
      };

      if (currentDelay > 0) {
        const t = setTimeout(() => {
          timers.delete(t);
          respond();
        }, currentDelay);
        t.unref();
        timers.add(t);
      } else {
        respond();
      }
    });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.removeListener('error', reject);
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind mock HTTP server'));
        return;
      }
      resolve(addr.port);
    });
  });

  const url = `http://${host}:${port}`;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const t of Array.from(timers)) {
      clearTimeout(t);
    }
    timers.clear();
    for (const sock of Array.from(sockets)) {
      sock.destroy();
    }
    sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return {
    host,
    port,
    url,
    requests,
    setResponse: (nextStatus: number, nextBody?: string, nextDelayMs?: number) => {
      currentStatus = nextStatus;
      if (nextBody !== undefined) currentBody = nextBody;
      if (nextDelayMs !== undefined) currentDelay = nextDelayMs;
    },
    close,
  };
}

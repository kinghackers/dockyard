import { Client, ConnectConfig } from 'ssh2';
import * as net from 'net';
import * as fs from 'fs';

export interface SshAuthOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export interface SshTunnel {
  localPort: number;
  close: () => Promise<void>;
  /** Open an interactive shell on the SSH host (for host terminals). */
  openShell?: (
    cols: number,
    rows: number,
    cb: (err: Error | null, stream?: NodeJS.ReadWriteStream) => void
  ) => void;
}

/** Bridge an ssh2 shell stream through the shared callback shape. */
function shellOpener(conn: Client): SshTunnel['openShell'] {
  return (cols, rows, cb) => {
    conn.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
      if (err || !stream) {
        cb(err ?? null, undefined);
        return;
      }
      // attach before returning so an unhandled channel error can never
      // crash the main process before the caller adds its own listener
      stream.on('error', () => {
        /* channel-level errors are surfaced by the session owner */
      });
      cb(null, stream as unknown as NodeJS.ReadWriteStream);
    });
  };
}

function buildSshConfig(opts: SshAuthOptions): ConnectConfig {
  const cfg: ConnectConfig = {
    host: opts.host,
    port: opts.port || 22,
    username: opts.username,
    readyTimeout: 20000,
    keepaliveInterval: 10000,
  };
  if (opts.password) cfg.password = opts.password;
  if (opts.privateKeyPath) {
    cfg.privateKey = fs.readFileSync(opts.privateKeyPath);
    if (opts.passphrase) cfg.passphrase = opts.passphrase;
  }
  return cfg;
}

/**
 * Each incoming local TCP connection is bridged to a remote Docker HTTP API
 * stream over SSH. Prefers `docker system dial-stdio` (the same transport
 * `docker -H ssh://` uses), falls back to `socat` on the unix socket.
 */
export async function createSshDockerTunnel(
  ssh: SshAuthOptions,
  dockerSocketPath = '/var/run/docker.sock'
): Promise<SshTunnel> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let server: net.Server | null = null;
    let settled = false;
    const sockets = new Set<net.Socket>();

    const cleanup = () => {
      for (const s of sockets) {
        try {
          s.destroy();
        } catch {
          /* ignore */
        }
      }
      sockets.clear();
      try {
        server?.close();
      } catch {
        /* ignore */
      }
      try {
        conn.end();
      } catch {
        /* ignore */
      }
    };

    conn.on('ready', () => {
      const bridge = (client: net.Socket) => {
        sockets.add(client);
        client.on('close', () => sockets.delete(client));
        client.on('error', () => sockets.delete(client));

        // docker system dial-stdio: speak Docker API over stdio
        conn.exec('docker system dial-stdio', (err, stream) => {
          if (err) {
            // fallback: pipe to the unix socket via socat. The socket path
            // comes from connection config — single-quote it so a crafted
            // value can't smuggle extra shell commands to the remote host
            const safeSocket = dockerSocketPath.replace(/'/g, `'\\''`);
            conn.exec(`socat -u STDIO UNIX-CONNECT:'${safeSocket}'`, (err2, stream2) => {
              if (err2) {
                client.destroy();
                return;
              }
              client.pipe(stream2 as unknown as NodeJS.WritableStream);
              (stream2 as unknown as NodeJS.ReadableStream).pipe(client);
              stream2.on('close', () => client.destroy());
              client.on('close', () => stream2.end());
            });
            return;
          }
          client.pipe(stream as unknown as NodeJS.WritableStream);
          (stream as unknown as NodeJS.ReadableStream).pipe(client);
          stream.on('close', () => client.destroy());
          client.on('close', () => stream.end());
        });
      };

      server = net.createServer(bridge);
      server.on('error', (e) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(e);
        }
      });

      server.listen(0, '127.0.0.1', () => {
        const addr = server!.address() as net.AddressInfo;
        if (!settled) {
          settled = true;
          resolve({
            localPort: addr.port,
            close: async () => cleanup(),
            openShell: shellOpener(conn),
          });
        }
      });
    });

    conn.on('error', (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      } else {
        // post-connect failure: tear everything down so callers see clean
        // ECONNRESETs instead of hanging on a half-dead tunnel
        console.error(`[sshTunnel] connection error after ready: ${err.message}`);
        cleanup();
      }
    });

    conn.connect(buildSshConfig(ssh));
  });
}

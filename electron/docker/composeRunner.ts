import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type { DockerConnectionConfig } from './types';

export interface ComposeResult {
  ok: boolean;
  output: string;
  exitCode: number | null;
}

/**
 * Run `docker compose …` against the selected connection.
 * Needs the Docker CLI on PATH. TLS material is staged to a temp dir under
 * `configDir` when inline certs are configured; the process tree is killed
 * after a generous timeout so a hung pull cannot wedge the promise forever.
 */
export async function runComposeCommand(
  cfg: DockerConnectionConfig,
  configDir: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number }
): Promise<ComposeResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const staged: string[] = [];
  const tmpDir = path.join(configDir, `compose-tls-${Date.now().toString(36)}`);

  try {
    if (cfg.kind === 'unix') {
      env.DOCKER_HOST = `unix://${cfg.socketPath || '/var/run/docker.sock'}`;
    } else if (cfg.kind === 'tcp') {
      env.DOCKER_HOST = `tcp://${cfg.host || '127.0.0.1'}:${cfg.port || 2375}`;
      if (cfg.tls) {
        env.DOCKER_TLS_VERIFY = '1';
        // 0o700: the staged key.pem must not be readable by other local users
        fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
        const stage = (name: string, inline?: string, filePath?: string) => {
          const dest = path.join(tmpDir, name);
          if (inline && inline.trim()) {
            fs.writeFileSync(dest, inline, { encoding: 'utf8', mode: 0o600 });
            staged.push(dest);
            return;
          }
          if (filePath && fs.existsSync(filePath) && filePath !== dest) {
            fs.copyFileSync(filePath, dest);
            fs.chmodSync(dest, 0o600);
            staged.push(dest);
          }
        };
        stage('ca.pem', cfg.ca, cfg.caCertPath);
        stage('cert.pem', cfg.cert, cfg.certPath);
        stage('key.pem', cfg.key, cfg.keyPath);
        env.DOCKER_CERT_PATH = tmpDir;
      }
    } else if (cfg.kind === 'ssh') {
      // best-effort: docker CLI can use DOCKER_HOST=ssh:// when keys work
      const user = cfg.sshUser || 'root';
      const port = cfg.sshPort || 22;
      env.DOCKER_HOST = `ssh://${user}@${cfg.sshHost}:${port}`;
    }

    return await new Promise<ComposeResult>((resolve) => {
      const child = spawn('docker', ['compose', ...args], {
        env,
        cwd: opts?.cwd || process.cwd(),
        windowsHide: true,
      });
      let out = '';
      const cap = (s: string) => {
        out += s;
        if (out.length > 200_000) out = out.slice(-150_000);
      };
      child.stdout.on('data', (d: Buffer) => cap(d.toString('utf8')));
      child.stderr.on('data', (d: Buffer) => cap(d.toString('utf8')));

      let settled = false;
      const settle = (r: ComposeResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const timeoutMs = opts?.timeoutMs ?? 10 * 60_000;
      const timer = setTimeout(() => {
        if (child.pid) {
          if (process.platform === 'win32') {
            // compose spawns helper processes; taskkill takes down the tree
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
          } else {
            try {
              child.kill('SIGKILL');
            } catch {
              /* ignore */
            }
          }
        }
        settle({
          ok: false,
          output: `${out.trim()}\n\n操作超时（${Math.round(timeoutMs / 60_000)} 分钟未完成），已终止 docker compose 进程。`.trim(),
          exitCode: null,
        });
      }, timeoutMs);

      child.on('error', (err) => {
        settle({
          ok: false,
          output: `无法启动 docker CLI：${err.message}\n请确认已安装 Docker 并加入 PATH。`,
          exitCode: null,
        });
      });
      child.on('close', (code) => {
        settle({ ok: code === 0, output: out.trim(), exitCode: code });
      });
    });
  } finally {
    for (const p of staged) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Remove compose-tls-* staging dirs left behind by runs that were killed
 * mid-flight (crash, power loss) — they contain client TLS keys.
 */
export function sweepStaleComposeTls(configDir: string) {
  try {
    for (const name of fs.readdirSync(configDir)) {
      if (!name.startsWith('compose-tls-')) continue;
      try {
        fs.rmSync(path.join(configDir, name), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

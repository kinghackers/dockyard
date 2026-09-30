import { ipcMain, BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { DockerConnectionManager } from './connectionManager';
import { DockerConnectionConfig } from './types';

const logStreams = new Map<string, { abort: () => void }>();
const execSessions = new Map<string, { write: (chunk: string) => void; resize: (h: number, w: number) => void; kill: () => void }>();

export function registerIpc(manager: DockerConnectionManager, getWindows: () => BrowserWindow[]) {
  // ---- connection config ----
  ipcMain.handle('docker:listConnections', () => manager.listConfigs());

  ipcMain.handle('docker:upsertConnection', (_e, cfg: DockerConnectionConfig) => {
    return manager.upsertConfig(cfg);
  });

  ipcMain.handle('docker:removeConnection', async (_e, id: string) => {
    manager.removeConfig(id);
    return true;
  });

  ipcMain.handle('docker:testConnection', (_e, cfg: DockerConnectionConfig) => {
    return manager.testConfig(cfg);
  });

  ipcMain.handle('docker:connect', (_e, id: string) => manager.connect(id));
  ipcMain.handle('docker:disconnect', async (_e, id: string) => {
    await manager.disconnect(id);
    return true;
  });
  ipcMain.handle('docker:listStatuses', () => manager.listStatuses());

  // ---- containers ----
  ipcMain.handle('docker:listContainers', (_e, hostId: string, all?: boolean) =>
    manager.listContainers(hostId, all)
  );
  ipcMain.handle('docker:inspectContainer', (_e, hostId: string, id: string) =>
    manager.inspectContainer(hostId, id)
  );
  ipcMain.handle('docker:startContainer', async (_e, hostId: string, id: string) => {
    await manager.startContainer(hostId, id);
    return true;
  });
  ipcMain.handle('docker:stopContainer', async (_e, hostId: string, id: string) => {
    await manager.stopContainer(hostId, id);
    return true;
  });
  ipcMain.handle('docker:restartContainer', async (_e, hostId: string, id: string) => {
    await manager.restartContainer(hostId, id);
    return true;
  });
  ipcMain.handle('docker:killContainer', async (_e, hostId: string, id: string) => {
    await manager.killContainer(hostId, id);
    return true;
  });
  ipcMain.handle('docker:removeContainer', async (_e, hostId: string, id: string, force?: boolean) => {
    await manager.removeContainer(hostId, id, force);
    return true;
  });
  ipcMain.handle('docker:pauseContainer', async (_e, hostId: string, id: string) => {
    await manager.pauseContainer(hostId, id);
    return true;
  });
  ipcMain.handle('docker:unpauseContainer', async (_e, hostId: string, id: string) => {
    await manager.unpauseContainer(hostId, id);
    return true;
  });

  // ---- logs (streaming via events) ----
  ipcMain.handle(
    'docker:openLogs',
    async (e: IpcMainInvokeEvent, hostId: string, containerId: string, tail?: number) => {
      const key = `${hostId}:${containerId}`;
      logStreams.get(key)?.abort();
      const win = BrowserWindow.fromWebContents(e.sender);

      const stream = await manager.containerLogStream(hostId, containerId, {
        tail: tail ?? 200,
        follow: true,
      });
      const destroyable = stream as NodeJS.ReadableStream & { destroy?: () => void };

      // Docker multiplexed frames: [type(1),0,0,0,size(4,BE)] + payload.
      // Frames can span chunks, so keep a residual buffer.
      let residual = Buffer.alloc(0);

      const onData = (chunk: Buffer) => {
        residual = Buffer.concat([residual, chunk]);
        let text = '';
        let offset = 0;
        while (offset < residual.length) {
          // If less than 8 bytes remain, wait for more
          if (residual.length - offset < 8) break;
          const type = residual[offset];
          if (type === 0 || type === 1 || type === 2 || type === 3) {
            const size = residual.readUInt32BE(offset + 4);
            const frameStart = offset + 8;
            const frameEnd = frameStart + size;
            // Incomplete payload — wait for more data
            if (residual.length < frameEnd) break;
            if (type === 1 || type === 2) {
              text += residual.slice(frameStart, frameEnd).toString('utf8');
            }
            offset = frameEnd;
          } else {
            // Not a valid frame header (e.g. TTY raw output) — emit the rest as-is
            text += residual.slice(offset).toString('utf8');
            offset = residual.length;
          }
        }
        residual = residual.slice(offset);
        if (text) {
          win?.webContents.send('docker:logData', { key, data: text });
        }
      };

      destroyable.on('data', onData);
      destroyable.on('error', (err: Error) => {
        win?.webContents.send('docker:logError', { key, error: err.message });
      });
      destroyable.on('end', () => {
        // flush any residual as plain text
        if (residual.length > 0) {
          win?.webContents.send('docker:logData', { key, data: residual.toString('utf8') });
          residual = Buffer.alloc(0);
        }
        win?.webContents.send('docker:logEnd', { key });
        logStreams.delete(key);
      });

      const abort = () => {
        try {
          destroyable.destroy?.();
          destroyable.removeAllListeners();
        } catch {
          /* ignore */
        }
        logStreams.delete(key);
      };
      logStreams.set(key, { abort });
      return true;
    }
  );

  ipcMain.handle('docker:closeLogs', (_e, hostId: string, containerId: string) => {
    const key = `${hostId}:${containerId}`;
    logStreams.get(key)?.abort();
    return true;
  });

  // ---- exec / terminal ----
  ipcMain.handle(
    'docker:openExec',
    async (e: IpcMainInvokeEvent, hostId: string, containerId: string, sessionId: string) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const exec = await manager.createExec(hostId, containerId, ['/bin/sh', '-c', 'bash || sh || ash']);
      const stream = await manager.startExec(exec.id, hostId);

      const onData = (buf: Buffer) => {
        win?.webContents.send('docker:execData', { sessionId, data: buf.toString('utf8') });
      };
      stream.on('data', onData);
      stream.on('error', (err: Error) => {
        win?.webContents.send('docker:execError', { sessionId, error: err.message });
      });
      stream.on('end', () => {
        win?.webContents.send('docker:execEnd', { sessionId });
        execSessions.delete(sessionId);
      });

      execSessions.set(sessionId, {
        write: (chunk: string) => {
          stream.write(chunk);
        },
        resize: (h: number, w: number) => {
          void manager.resizeExec(exec.id, hostId, h, w);
        },
        kill: () => {
          try {
            stream.end();
          } catch {
            /* ignore */
          }
          execSessions.delete(sessionId);
        },
      });

      return true;
    }
  );

  ipcMain.handle('docker:execInput', (_e, sessionId: string, data: string) => {
    execSessions.get(sessionId)?.write(data);
    return true;
  });

  ipcMain.handle('docker:execResize', (_e, sessionId: string, h: number, w: number) => {
    execSessions.get(sessionId)?.resize(h, w);
    return true;
  });

  ipcMain.handle('docker:closeExec', (_e, sessionId: string) => {
    execSessions.get(sessionId)?.kill();
    return true;
  });

  // ---- images / networks / volumes ----
  ipcMain.handle('docker:listImages', (_e, hostId: string) => manager.listImages(hostId));
  ipcMain.handle('docker:removeImage', async (_e, hostId: string, id: string, force?: boolean) => {
    await manager.removeImage(hostId, id, force);
    return true;
  });
  ipcMain.handle('docker:pullImage', async (e, hostId: string, name: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    await manager.pullImage(hostId, name, (msg) => {
      win?.webContents.send('docker:pullProgress', { name, message: msg });
    });
    return true;
  });

  ipcMain.handle('docker:listNetworks', (_e, hostId: string) => manager.listNetworks(hostId));
  ipcMain.handle('docker:removeNetwork', async (_e, hostId: string, id: string) => {
    await manager.removeNetwork(hostId, id);
    return true;
  });

  ipcMain.handle('docker:listVolumes', (_e, hostId: string) => manager.listVolumes(hostId));
  ipcMain.handle('docker:removeVolume', async (_e, hostId: string, name: string, force?: boolean) => {
    await manager.removeVolume(hostId, name, force);
    return true;
  });

  // ---- compose / stats ----
  ipcMain.handle('docker:listComposeProjects', (_e, hostId: string) => manager.listComposeProjects(hostId));
  ipcMain.handle('docker:listUnclassified', (_e, hostId: string) => manager.listUnclassifiedContainers(hostId));
  ipcMain.handle('docker:systemStats', (_e, hostId: string) => manager.systemStats(hostId));
  ipcMain.handle('docker:systemInfo', async (_e, hostId: string) => {
    const s = manager.status(hostId);
    return s?.info;
  });

  // cleanup all streams
  ipcMain.handle('docker:cleanupAll', async () => {
    for (const { abort } of logStreams.values()) abort();
    logStreams.clear();
    for (const s of execSessions.values()) s.kill();
    execSessions.clear();
    await manager.disconnectAll();
    return true;
  });
}

export function broadcastToAll(windows: BrowserWindow[], channel: string, payload: unknown) {
  for (const w of windows) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

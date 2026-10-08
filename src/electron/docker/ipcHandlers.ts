import { ipcMain, BrowserWindow, IpcMainInvokeEvent, dialog } from 'electron';
import * as path from 'path';
import { DockerConnectionManager } from './connectionManager';
import {
  ConnectionGroup,
  CreateContainerOptions,
  CreateNetworkOptions,
  CreateVolumeOptions,
  DockerConnectionConfig,
} from './types';

const logStreams = new Map<string, { abort: () => void }>();
const execSessions = new Map<string, { write: (chunk: string) => void; resize: (h: number, w: number) => void; kill: () => void }>();
const eventStreams = new Map<string, { abort: () => void }>();
const statsStreams = new Map<string, { abort: () => void }>();

/**
 * File paths the user actually picked via docker:selectFile. Only these may
 * be read by docker:readTextFile or executed by compose handlers — otherwise
 * a compromised renderer could read arbitrary files off the disk.
 */
const userSelectedFiles = new Set<string>();

function requireUserSelected(filePath: string) {
  if (!userSelectedFiles.has(path.resolve(filePath))) {
    throw new Error('只能访问通过文件选择器选择的文件');
  }
}

export function registerIpc(manager: DockerConnectionManager, getWindows: () => BrowserWindow[]) {
  // ---- connection config ----
  ipcMain.handle('docker:listConnections', () => manager.listConfigs());
  ipcMain.handle('docker:configHealth', () => manager.configHealth());

  ipcMain.handle('docker:upsertConnection', (_e, cfg: DockerConnectionConfig) => {
    return manager.upsertConfig(cfg);
  });

  ipcMain.handle('docker:removeConnection', async (_e, id: string) => {
    manager.removeConfig(id);
    return true;
  });

  // ---- sidebar groups ----
  ipcMain.handle('docker:listGroups', () => manager.listGroups());
  ipcMain.handle('docker:upsertGroup', (_e, group: ConnectionGroup) => manager.upsertGroup(group));
  ipcMain.handle('docker:removeGroup', async (_e, id: string) => {
    manager.removeGroup(id);
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
  ipcMain.handle(
    'docker:listContainers',
    (_e, hostId: string, all?: boolean, enrichPorts?: boolean) =>
      manager.listContainers(hostId, all, { enrichPorts })
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
  ipcMain.handle(
    'docker:updateRestartPolicy',
    async (
      _e,
      hostId: string,
      id: string,
      policy: 'no' | 'always' | 'on-failure' | 'unless-stopped',
      maximumRetryCount?: number
    ) => {
      await manager.updateRestartPolicy(hostId, id, policy, maximumRetryCount ?? 0);
      return true;
    }
  );
  ipcMain.handle('docker:stopRestartLoop', (_e, hostId: string, id: string) =>
    manager.stopRestartLoop(hostId, id)
  );
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

  ipcMain.handle('docker:renameContainer', async (_e, hostId: string, id: string, name: string) => {
    await manager.renameContainer(hostId, id, name);
    return true;
  });
  ipcMain.handle(
    'docker:updateContainerResources',
    async (_e, hostId: string, id: string, opts: { memoryMB?: number; cpuCores?: number }) => {
      await manager.updateContainerResources(hostId, id, opts);
      return true;
    }
  );
  ipcMain.handle(
    'docker:commitContainer',
    (_e, hostId: string, id: string, opts: { repo: string; tag?: string; comment?: string }) =>
      manager.commitContainer(hostId, id, opts)
  );

  // ---- create ----
  ipcMain.handle('docker:createContainer', async (_e, hostId: string, opts: CreateContainerOptions, start?: boolean) => {
    return manager.createContainer(hostId, opts, start ?? true);
  });
  ipcMain.handle('docker:createNetwork', async (_e, hostId: string, opts: CreateNetworkOptions) => {
    return manager.createNetwork(hostId, opts);
  });
  ipcMain.handle('docker:createVolume', async (_e, hostId: string, opts: CreateVolumeOptions) => {
    return manager.createVolume(hostId, opts);
  });

  ipcMain.handle('docker:composeUp', (_e, hostId: string, filePath: string) => {
    requireUserSelected(filePath);
    return manager.composeUp(hostId, filePath);
  });
  ipcMain.handle('docker:composeFileDown', (_e, hostId: string, filePath: string, volumes?: boolean) => {
    requireUserSelected(filePath);
    return manager.composeFileDown(hostId, filePath, volumes);
  });
  ipcMain.handle(
    'docker:composeProjectDown',
    (_e, hostId: string, projectName: string, volumes?: boolean) =>
      manager.composeProjectDown(hostId, projectName, volumes)
  );
  ipcMain.handle('docker:composeProjectPull', (_e, hostId: string, projectName: string) =>
    manager.composeProjectPull(hostId, projectName)
  );

  ipcMain.handle('docker:selectFile', async (e, filters?: { name: string; extensions: string[] }[]) => {
    const win = BrowserWindow.fromWebContents(e.sender) || undefined;
    const res = await dialog.showOpenDialog(win as BrowserWindow, {
      properties: ['openFile'],
      filters: filters?.length ? filters : [{ name: 'Compose 文件', extensions: ['yml', 'yaml'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    userSelectedFiles.add(path.resolve(res.filePaths[0]));
    return res.filePaths[0];
  });

  ipcMain.handle('docker:readTextFile', async (_e, filePath: string) => {
    requireUserSelected(filePath);
    const fs = await import('fs');
    return fs.readFileSync(filePath, 'utf8');
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
      // Once we decide this is a raw (TTY) stream, stop frame-parsing entirely.
      let rawMode = false;

      const onData = (chunk: Buffer) => {
        residual = Buffer.concat([residual, chunk]);
        let text = '';
        let offset = 0;

        if (rawMode) {
          text = residual.toString('utf8');
          residual = Buffer.alloc(0);
          if (text) win?.webContents.send('docker:logData', { key, data: text });
          return;
        }

        while (offset < residual.length) {
          // If less than 8 bytes remain, wait for more
          if (residual.length - offset < 8) break;
          const type = residual[offset];
          const b1 = residual[offset + 1];
          const b2 = residual[offset + 2];
          const b3 = residual[offset + 3];
          // header reserved bytes must be 0 for a real frame
          const looksLikeFrame =
            (type === 0 || type === 1 || type === 2 || type === 3) && b1 === 0 && b2 === 0 && b3 === 0;

          if (looksLikeFrame) {
            const size = residual.readUInt32BE(offset + 4);
            // absurd size → almost certainly raw TTY data, switch mode
            if (size > 64 * 1024 * 1024) {
              rawMode = true;
              text += residual.slice(offset).toString('utf8');
              offset = residual.length;
              break;
            }
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
            rawMode = true;
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
      // ensure flowing mode even if the underlying stream was paused
      destroyable.resume?.();
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
          // drop listeners BEFORE destroy so a sync 'end' cannot notify the UI
          destroyable.removeAllListeners();
          destroyable.destroy?.();
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
  ipcMain.handle('docker:inspectImage', (_e, hostId: string, id: string) =>
    manager.inspectImage(hostId, id)
  );
  ipcMain.handle('docker:removeImage', async (_e, hostId: string, id: string, force?: boolean) => {
    await manager.removeImage(hostId, id, force);
    return true;
  });
  ipcMain.handle('docker:tagImage', async (_e, hostId: string, id: string, repo: string, tag?: string) => {
    await manager.tagImage(hostId, id, repo, tag);
    return true;
  });
  ipcMain.handle('docker:pullImage', async (e, hostId: string, name: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    await manager.pullImage(hostId, name, (msg) => {
      win?.webContents.send('docker:pullProgress', { name, message: msg });
    });
    return true;
  });
  ipcMain.handle('docker:pushImage', async (e, hostId: string, name: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    await manager.pushImage(hostId, name, (msg) => {
      win?.webContents.send('docker:pushProgress', { name, message: msg });
    });
    return true;
  });

  // docker save / load with native file dialogs on the main side
  ipcMain.handle('docker:saveImage', async (e, hostId: string, name: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const safe = name.replace(/[\\/:*?"<>|]/g, '_');
    const dest = await dialog.showSaveDialog(win as BrowserWindow, {
      defaultPath: `${safe}.tar`,
      filters: [{ name: '镜像 tar 包', extensions: ['tar'] }],
    });
    if (dest.canceled || !dest.filePath) return { ok: false, canceled: true };
    try {
      const bytes = await manager.saveImageToFile(hostId, name, dest.filePath);
      return { ok: true, path: dest.filePath, bytes };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('docker:loadImage', async (e, hostId: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const pick = await dialog.showOpenDialog(win as BrowserWindow, {
      properties: ['openFile'],
      filters: [{ name: '镜像 tar 包', extensions: ['tar'] }],
    });
    if (pick.canceled || pick.filePaths.length === 0) return { ok: false, canceled: true };
    try {
      const output = await manager.loadImageFromFile(hostId, pick.filePaths[0]);
      return { ok: true, path: pick.filePaths[0], output };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
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
  ipcMain.handle('docker:systemDf', (_e, hostId: string) => manager.systemDf(hostId));
  ipcMain.handle(
    'docker:pruneSystem',
    async (_e, hostId: string, opts: {
      danglingImages?: boolean;
      stoppedContainers?: boolean;
      unusedNetworks?: boolean;
      unusedVolumes?: boolean;
    }) => manager.pruneSystem(hostId, opts)
  );
  ipcMain.handle('docker:systemStats', async (_e, hostId: string) => {
    try {
      return await manager.systemStats(hostId);
    } catch (e) {
      // connection-level failures (ECONNRESET / hang up) — return a clean error
      // instead of letting ipcMain.handle log a raw stack for every poll
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(msg.includes('ECONNRESET') || msg.includes('socket hang up')
        ? `与 Docker 主机的连接中断: ${hostId}`
        : msg);
    }
  });
  ipcMain.handle('docker:systemInfo', async (_e, hostId: string) => {
    const s = manager.status(hostId);
    return s?.info;
  });

  // ---- live container stats (streaming via events) ----
  ipcMain.handle(
    'docker:openStats',
    async (e: IpcMainInvokeEvent, hostId: string, containerId: string) => {
      const key = `${hostId}:${containerId}`;
      statsStreams.get(key)?.abort();
      const win = BrowserWindow.fromWebContents(e.sender);

      const abort = manager.streamContainerStats(
        hostId,
        containerId,
        (sample) => {
          win?.webContents.send('docker:statsData', { key, hostId, containerId, sample });
        },
        (err) => {
          win?.webContents.send('docker:statsError', { key, error: err.message });
        }
      );
      statsStreams.set(key, { abort });
      return true;
    }
  );

  ipcMain.handle('docker:closeStats', (_e, hostId: string, containerId: string) => {
    const key = `${hostId}:${containerId}`;
    statsStreams.get(key)?.abort();
    statsStreams.delete(key);
    return true;
  });

  // ---- docker events (auto-refresh) ----
  ipcMain.handle('docker:openEvents', async (e: IpcMainInvokeEvent, hostId: string) => {
    eventStreams.get(hostId)?.abort();
    const win = BrowserWindow.fromWebContents(e.sender);

    const abort = manager.streamEvents(
      hostId,
      (event) => {
        win?.webContents.send('docker:event', event);
      },
      (err) => {
        win?.webContents.send('docker:eventError', { hostId, error: err.message });
      }
    );
    eventStreams.set(hostId, { abort });
    return true;
  });

  ipcMain.handle('docker:closeEvents', (_e, hostId: string) => {
    eventStreams.get(hostId)?.abort();
    eventStreams.delete(hostId);
    return true;
  });

  // cleanup all streams
  ipcMain.handle('docker:cleanupAll', async () => {
    for (const { abort } of logStreams.values()) abort();
    logStreams.clear();
    for (const s of execSessions.values()) s.kill();
    execSessions.clear();
    for (const { abort } of eventStreams.values()) abort();
    eventStreams.clear();
    for (const { abort } of statsStreams.values()) abort();
    statsStreams.clear();
    await manager.disconnectAll();
    return true;
  });
}

export function broadcastToAll(windows: BrowserWindow[], channel: string, payload: unknown) {
  for (const w of windows) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

import * as fs from 'fs';
import Docker = require('dockerode');
import type { ImageDetail, ImageSummary } from './types';

/**
 * Image operations against a connected docker engine — extracted from
 * DockerConnectionManager so each module stays reviewable.
 */

export async function listImages(docker: Docker): Promise<ImageSummary[]> {
  const list = await docker.listImages({ all: false });
  return list.map((i) => ({
    id: i.Id,
    repoTags: i.RepoTags || [],
    repoDigests: i.RepoDigests || [],
    created: i.Created,
    size: i.Size,
    virtualSize: i.VirtualSize,
    labels: i.Labels || {},
  }));
}

/** Image metadata + build history (layer commands). */
export async function inspectImage(docker: Docker, id: string): Promise<ImageDetail> {
  const img = (await docker.getImage(id).inspect()) as Docker.ImageInspectInfo & {
    History?: {
      Created?: string;
      CreatedBy?: string;
      Comment?: string;
      Size?: number;
      emptyLayer?: boolean;
    }[];
  };
  const entry = img.Config?.Entrypoint;
  return {
    id: img.Id,
    repoTags: img.RepoTags || [],
    repoDigests: img.RepoDigests || [],
    created: img.Created,
    size: img.Size || 0,
    virtualSize: img.VirtualSize,
    architecture: img.Architecture,
    os: img.Os,
    author: img.Author,
    configCmd: Array.isArray(img.Config?.Cmd) ? img.Config.Cmd.join(' ') : img.Config?.Cmd || '',
    configEntrypoint: Array.isArray(entry) ? entry : entry ? [entry] : [],
    env: img.Config?.Env || [],
    labels: img.Config?.Labels || {},
    history: (img.History || []).map((h) => ({
      created: h.Created,
      createdBy: h.CreatedBy,
      comment: h.Comment,
      size: h.Size,
      emptyLayer: h.emptyLayer,
    })),
  };
}

export async function removeImage(docker: Docker, id: string, force = false) {
  await docker.getImage(id).remove({ force });
}

/** Add a repo:tag to an existing image. */
export async function tagImage(docker: Docker, id: string, repo: string, tag = 'latest') {
  const r = repo.trim();
  if (!r) throw new Error('镜像名称不能为空');
  await docker
    .getImage(id)
    .tag({ repo: r, tag: (tag || 'latest').trim() });
}

export async function pullImage(
  docker: Docker,
  name: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    docker.pull(name, (err: Error | null, stream?: NodeJS.ReadableStream) => {
      if (err || !stream) return reject(err || new Error('拉取镜像失败'));
      docker.modem.followProgress(
        stream,
        (e: Error | null) => (e ? reject(e) : resolve()),
        (event: { status?: string; progress?: string; id?: string }) => {
          onProgress?.(`${event.id || ''} ${event.status || ''} ${event.progress || ''}`.trim());
        }
      );
    });
  });
}

/** Push an image tag to its registry (requires prior `docker login` on that host). */
export async function pushImage(
  docker: Docker,
  name: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = docker.getImage(name);
    image.push({}, (err: Error | null, stream?: NodeJS.ReadableStream) => {
      if (err || !stream) return reject(err || new Error('推送镜像失败'));
      docker.modem.followProgress(
        stream,
        (e: Error | null) => {
          if (e) reject(e);
          else resolve();
        },
        (event: {
          status?: string;
          progress?: string;
          id?: string;
          error?: string;
          errorDetail?: { message?: string };
        }) => {
          if (event.error) {
            reject(new Error(event.errorDetail?.message || event.error));
            return;
          }
          onProgress?.(`${event.id || ''} ${event.status || ''} ${event.progress || ''}`.trim());
        }
      );
    });
  });
}

/** Stream an image out as a tar (docker save) to the given file path. Returns bytes written. */
export async function saveImageToFile(docker: Docker, name: string, destPath: string): Promise<number> {
  const stream = await docker.getImage(name).get();
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    const fail = (err: Error) => {
      // destroy the write side so its fd does not stay open until exit
      // (on Windows that keeps the partial .tar locked)
      out.destroy();
      reject(err);
    };
    stream.on('data', (c: Buffer) => {
      bytes += c.length;
    });
    stream.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => resolve());
    stream.pipe(out);
  });
  return bytes;
}

/** Load an image from a tar file (docker load). Returns daemon output. */
export async function loadImageFromFile(docker: Docker, filePath: string): Promise<string> {
  const res = await docker.loadImage(fs.createReadStream(filePath));
  let out = '';
  const s = res as unknown as NodeJS.ReadableStream;
  if (s && typeof s.on === 'function') {
    await new Promise<void>((resolve, reject) => {
      s.on('data', (b: Buffer) => {
        out += b.toString('utf8');
      });
      s.on('end', () => resolve());
      s.on('error', reject);
    });
  }
  return out.trim() || '(无输出)';
}

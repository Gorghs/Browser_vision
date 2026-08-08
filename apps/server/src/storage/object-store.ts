import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { StorageError } from '../lib/errors.js';

/**
 * Where screenshot bytes live.
 *
 * PostgreSQL holds the metadata and the path; the image itself goes here. The
 * interface exists so the local filesystem can stand in for Supabase Storage
 * when no credentials are configured, exactly as the in-memory repositories
 * stand in for the database.
 */
export interface ObjectStore {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
  readonly bucket: string;
  readonly kind: 'supabase' | 'filesystem';
}

/** Groups captures by day, so a directory listing stays navigable. */
export function screenshotPath(screenshotId: string, capturedAt: string, format: string): string {
  const day = capturedAt.slice(0, 10);
  return `${day}/${screenshotId}.${format === 'png' ? 'png' : 'jpg'}`;
}

export function createSupabaseObjectStore(client: SupabaseClient, bucket: string): ObjectStore {
  return {
    bucket,
    kind: 'supabase',

    async put(path, bytes, contentType) {
      const { error } = await client.storage.from(bucket).upload(path, bytes, {
        contentType,
        // An upload retried after a lost response should overwrite rather than
        // fail: the row it belongs to is keyed on the same client-generated id.
        upsert: true,
      });
      if (error) throw new StorageError(`Uploading ${path} failed: ${error.message}`, error);
    },

    async get(path) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error) throw new StorageError(`Downloading ${path} failed: ${error.message}`, error);
      return new Uint8Array(await data.arrayBuffer());
    },

    async remove(path) {
      const { error } = await client.storage.from(bucket).remove([path]);
      if (error) throw new StorageError(`Deleting ${path} failed: ${error.message}`, error);
    },
  };
}

/**
 * Filesystem-backed store for running without Supabase.
 *
 * Paths are resolved and checked against the root before use. They are built by
 * this codebase from a UUID, not taken from a request, but a store that writes
 * wherever it is told is one refactor away from a traversal bug.
 */
export function createFilesystemObjectStore(root: string): ObjectStore {
  const absoluteRoot = resolve(root);

  const safeJoin = (path: string): string => {
    const target = resolve(join(absoluteRoot, normalize(path)));
    if (target !== absoluteRoot && !target.startsWith(absoluteRoot + sep)) {
      throw new StorageError(`Refusing to access ${path}: outside the storage root.`);
    }
    return target;
  };

  return {
    bucket: absoluteRoot,
    kind: 'filesystem',

    async put(path, bytes) {
      const target = safeJoin(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    },

    async get(path) {
      try {
        return new Uint8Array(await readFile(safeJoin(path)));
      } catch (cause) {
        if (cause instanceof StorageError) throw cause;
        throw new StorageError(`Reading ${path} failed.`, cause);
      }
    },

    async remove(path) {
      await rm(safeJoin(path), { force: true });
    },
  };
}

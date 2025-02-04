import * as Comlink from 'comlink'
import type { FileSystemAdapter, StorageStats } from '../types';
import { PathUtils } from '../utils';

/**
 * Worker implementation of OPFS operations
 * Handles file system operations in a separate thread
 */
export class OPFSWorker implements FileSystemAdapter {
  private initialized: boolean = false;

  constructor() {
    console.log('[Worker] OPFSWorker initializing');
    this.initialized = true;
  }

  /**
   * Get a handle to a file system entry (file or directory)
   */
  private async getFSHandle<IsFile extends boolean, IsCreate extends boolean>(
    path: string,
    options: {
      create?: IsCreate;
      isFile: IsFile;
    }
  ) {
    console.log(`[Worker] Getting FS handle for path: ${path}, isFile: ${options.isFile}`);
    
    const { parent, name } = PathUtils.parsePath(path);

    try {
      if (parent === null) {
        const root = await navigator.storage.getDirectory();
        console.log('[Worker] Got root directory');
        return root as any;
      }

      const dirPaths = parent.split('/').filter((s) => s.length > 0);
      let dirHandle = await navigator.storage.getDirectory();

      for (const p of dirPaths) {
        console.log(`[Worker] Getting directory handle for: ${p}`);
        dirHandle = await dirHandle.getDirectoryHandle(p, { create: options.create });
      }

      if (options.isFile) {
        console.log(`[Worker] Getting file handle for: ${name}`);
        return await dirHandle.getFileHandle(name, { create: options.create });
      } else {
        console.log(`[Worker] Getting directory handle for: ${name}`);
        return await dirHandle.getDirectoryHandle(name, { create: options.create });
      }
    } catch (err) {
      console.error('[Worker] Error getting FS handle:', err);
      if ((err as Error).name === 'NotFoundError') {
        return null as any;
      }
      throw err;
    }
  }

  /**
   * Write data to a file
   */
  public async writeFile(path: string, data: ArrayBuffer): Promise<void> {
    console.log(`[Worker] Writing file: ${path}`);
    const fileHandle = await this.getFSHandle(path, { create: true, isFile: true });
    const writable = await fileHandle.createWritable();

    try {
      await writable.write(data);
      await writable.close();
      console.log(`[Worker] Successfully wrote file: ${path}`);
    } catch (error) {
      console.error('[Worker] Error writing file:', error);
      await writable.abort();
      throw error;
    }
  }

  /**
   * Read data from a file
   */
  public async readFile(path: string): Promise<ArrayBuffer> {
    const fileHandle = await this.getFSHandle(path, { create: false, isFile: true });
    if (!fileHandle) {
      throw new Error(`File not found: ${path}`);
    }
    const file = await fileHandle.getFile();
    return file.arrayBuffer();
  }

  /**
   * Delete a file
   */
  public async deleteFile(path: string): Promise<void> {
    const { parent, name } = PathUtils.parsePath(path);
    if (!parent) throw new Error('Invalid file path');

    const dirHandle = await this.getFSHandle(parent, { create: false, isFile: false });
    if (dirHandle) {
      await dirHandle.removeEntry(name);
    }
  }

  /**
   * Get size of a file
   */
  public async getFileSize(path: string): Promise<number> {
    const fileHandle = await this.getFSHandle(path, { create: false, isFile: true });
    if (!fileHandle) return 0;
    const file = await fileHandle.getFile();
    return file.size;
  }

  /**
   * Check if a file exists
   */
  public async exists(path: string): Promise<boolean> {
    try {
      const { parent, name } = PathUtils.parsePath(path);
      if (!parent) return true; // Root always exists

      const dirHandle = await this.getFSHandle(parent, { create: false, isFile: false });
      if (!dirHandle) return false;

      await dirHandle.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List directory contents
   */
  public async listDirectory(path: string): Promise<string[]> {
    const dirHandle = await this.getFSHandle(path, { create: false, isFile: false });
    if (!dirHandle) return [];

    const entries: string[] = [];
    for await (const entry of dirHandle.keys()) {
      entries.push(entry);
    }
    return entries;
  }

  /**
   * Get storage statistics
   */
  public async getStorageStats(): Promise<StorageStats> {
    const estimate = await navigator.storage.estimate();
    return {
      used: estimate.usage || 0,
      available: (estimate.quota || 0) - (estimate.usage || 0),
      total: estimate.quota || 0,
    };
  }

  /**
   * Ensure directory exists
   */
  public async ensureDirectory(dirPath: string[]): Promise<void> {
    console.log(`[Worker] Ensuring directory exists: ${dirPath.join('/')}`);
    const path = PathUtils.join(...dirPath);
    try {
      await this.getFSHandle(path, { create: true, isFile: false });
      console.log(`[Worker] Directory ensured: ${path}`);
    } catch (error) {
      console.error('[Worker] Error ensuring directory:', error);
      throw error;
    }
  }

  /**
   * Delete directory
   */
  public async deleteDirectory(path: string, options: { recursive?: boolean } = {}): Promise<void> {
    const { parent, name } = PathUtils.parsePath(path);
    if (!parent) return;

    const dirHandle = await this.getFSHandle(parent, { create: false, isFile: false });
    if (dirHandle) {
      await dirHandle.removeEntry(name, options);
    }
  }
}

// Expose the worker instance using Comlink
console.log('[Worker] Setting up Comlink exposure');
const worker = new OPFSWorker();
Comlink.expose(worker);
console.log('[Worker] Worker exposed via Comlink');
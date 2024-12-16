import { FileSystemAdapter, StorageStats } from './types';

/**
 * Adapter for Origin Private File System operations
 */
export class OPFSAdapter implements FileSystemAdapter {
  private root: FileSystemDirectoryHandle | null = null;

  /**
   * Initialize the OPFS root directory
   */
  private async getRoot(): Promise<FileSystemDirectoryHandle> {
    if (!this.root) {
      this.root = await navigator.storage.getDirectory();
    }
    return this.root;
  }

  /**
   * Sanitize file/directory name to be OPFS compatible, replaces invalid characters with underscores
   */
  public sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9-_]/g, '_');
  }

  /**
   * Get or create directory path
   */
  private async getDirectory(path: string): Promise<FileSystemDirectoryHandle> {
    const root = await this.getRoot();
    const parts = path.split('/').filter(Boolean)
                     .map(part => this.sanitizeName(part));

    let current = root;
    for (const part of parts) {
      if (part) {
        current = await current.getDirectoryHandle(part, { create: true });
      }
    }

    return current;
  }

  /**
   * Write data to a file
   */
  async writeFile(path: string, data: ArrayBuffer): Promise<void> {
    const { dir, name } = this.parsePath(path);
    const directory = await this.getDirectory(dir);
    const fileHandle = await directory.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();

    await writable.write(data);
    await writable.close();
  }

  /**
   * Read data from a file
   */
  async readFile(path: string): Promise<ArrayBuffer> {
    const { dir, name } = this.parsePath(path);
    const directory = await this.getDirectory(dir);
    const fileHandle = await directory.getFileHandle(name);
    const file = await fileHandle.getFile();

    return file.arrayBuffer();
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string): Promise<void> {
    const { dir, name } = this.parsePath(path);
    const directory = await this.getDirectory(dir);
    await directory.removeEntry(name);
  }

  /**
   * Get file size
   */
  async getFileSize(path: string): Promise<number> {
    const { dir, name } = this.parsePath(path);
    const directory = await this.getDirectory(dir);
    const fileHandle = await directory.getFileHandle(name);
    const file = await fileHandle.getFile();

    return file.size;
  }

  /**
   * Check if file exists
   */
  async exists(path: string): Promise<boolean> {
    try {
      const { dir, name } = this.parsePath(path);
      const directory = await this.getDirectory(dir);
      await directory.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<StorageStats> {
    const estimate = await navigator.storage.estimate();
    return {
      used: estimate.usage || 0,
      available: (estimate.quota || 0) - (estimate.usage || 0),
      total: estimate.quota || 0,
    };
  }

  /**
   * Parse path into directory and filename
   */
  private parsePath(path: string): { dir: string; name: string } {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop() || '';
    const dir = parts.join('/');
    return { dir, name };
  }
}

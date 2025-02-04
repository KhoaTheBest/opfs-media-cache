import * as Comlink from 'comlink';
import type { FileSystemAdapter, StorageStats } from '../types';

/**
 * Proxy adapter that communicates with the OPFS worker
 * Implements the FileSystemAdapter interface by forwarding calls to the worker
 */
export class OPFSProxyAdapter implements FileSystemAdapter {
  private worker: Worker;
  private proxy: Comlink.Remote<FileSystemAdapter>;
  private initialized: boolean = false;

  /**
   * Initialize the worker and create a proxy
   */
  constructor() {
    try {
      this.worker = new Worker(new URL('./opfs-worker', import.meta.url), {
        type: 'module',
      });
      
      this.worker.onerror = (error) => {
        console.error('Worker error:', error);
      };
      
      this.proxy = Comlink.wrap<FileSystemAdapter>(this.worker);
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize worker:', error);
      throw error;
    }
  }

  /**
   * Ensure the adapter is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      throw new Error('OPFSProxyAdapter not properly initialized');
    }
  }

  /**
   * Write data to a file via worker
   * @param path Target file path
   * @param data Data to write
   */
  public async writeFile(path: string, data: ArrayBuffer): Promise<void> {
    await this.ensureInitialized();
    try {
      return await this.proxy.writeFile(path, data);
    } catch (error) {
      console.error('Write file error:', error);
      throw error;
    }
  }

  /**
   * Read data from a file via worker
   * @param path Source file path
   */
  public async readFile(path: string): Promise<ArrayBuffer> {
    await this.ensureInitialized();
    try {
      return await this.proxy.readFile(path);
    } catch (error) {
      console.error('Read file error:', error);
      throw error;
    }
  }

  /**
   * Delete a file via worker
   * @param path Path to file to delete
   */
  public async deleteFile(path: string): Promise<void> {
    await this.ensureInitialized();
    try {
      return await this.proxy.deleteFile(path);
    } catch (error) {
      console.error('Delete file error:', error);
      throw error;
    }
  }

  /**
   * Get size of a file via worker
   * @param path Path to file
   */
  public async getFileSize(path: string): Promise<number> {
    await this.ensureInitialized();
    try {
      return await this.proxy.getFileSize(path);
    } catch (error) {
      console.error('Get file size error:', error);
      throw error;
    }
  }

  /**
   * Check if a file exists via worker
   * @param path Path to check
   */
  public async exists(path: string): Promise<boolean> {
    await this.ensureInitialized();
    try {
      return await this.proxy.exists(path);
    } catch (error) {
      console.error('Exists check error:', error);
      throw error;
    }
  }

  /**
   * List directory contents via worker
   * @param path Directory path
   */
  public async listDirectory(path: string): Promise<string[]> {
    await this.ensureInitialized();
    try {
      return await this.proxy.listDirectory(path);
    } catch (error) {
      console.error('List directory error:', error);
      throw error;
    }
  }

  /**
   * Get storage statistics via worker
   */
  public async getStorageStats(): Promise<StorageStats> {
    await this.ensureInitialized();
    try {
      return await this.proxy.getStorageStats();
    } catch (error) {
      console.error('Get storage stats error:', error);
      throw error;
    }
  }

  /**
   * Ensure directory exists via worker
   * @param dirPath Array of directory segments
   */
  public async ensureDirectory(dirPath: string[]): Promise<void> {
    await this.ensureInitialized();
    try {
      return await this.proxy.ensureDirectory(dirPath);
    } catch (error) {
      console.error('Ensure directory error:', error);
      throw error;
    }
  }

  /**
   * Delete directory via worker
   * @param path Directory path
   * @param options Deletion options
   */
  public async deleteDirectory(path: string, options: { recursive?: boolean } = {}): Promise<void> {
    await this.ensureInitialized();
    try {
      return await this.proxy.deleteDirectory(path, options);
    } catch (error) {
      console.error('Delete directory error:', error);
      throw error;
    }
  }

  /**
   * Terminate the worker
   * Should be called when the adapter is no longer needed
   */
  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.initialized = false;
    }
  }
}
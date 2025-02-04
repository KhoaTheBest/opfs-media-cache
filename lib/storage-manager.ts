import { AssetMetadata, CacheConfig, RequestOptions, StorageStats } from './types';
import { CACHE_PATH, MAX_STORAGE_SIZE } from './constants';
import { OPFSAdapter } from './opfs-adapter';
import { getFileExtension, hashUrl } from './utils';
import { OPFSProxyAdapter } from './workers/opfs-proxy-adapter';

/**
 * StorageManager class implementing singleton pattern for asset caching and retrieval
 * Uses improved OPFSAdapter for file system operations
 */
export class StorageManager {
  private static instance: StorageManager;
  private readonly adapter: OPFSProxyAdapter;
  private readonly config: CacheConfig;
  private cache: Map<string, AssetMetadata>;
  private downloadQueue: Set<string>;
  private isProcessingQueue: boolean;
  private currentStorageSize: number;

  /**
   * Private constructor to enforce singleton pattern
   * @param config Optional configuration overrides
   */
  private constructor(config?: Partial<CacheConfig>) {
    this.adapter = new OPFSProxyAdapter();
    this.config = {
      maxStorageSize: MAX_STORAGE_SIZE,
      cachePath: CACHE_PATH,
      ...config,
    };
    this.cache = new Map();
    this.downloadQueue = new Set();
    this.isProcessingQueue = false;
    this.currentStorageSize = 0;
  }

  /**
   * Get singleton instance
   * @param config Optional configuration
   */
  public static getInstance(config?: Partial<CacheConfig>): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager(config);
    }
    return StorageManager.instance;
  }

  /**
   * Initialize storage system and load metadata
   */
  public async initialize(): Promise<void> {
    try {
      await this.adapter.ensureDirectory(['pencil-opfs-storage']);
      await this.adapter.ensureDirectory(['pencil-opfs-storage', 'assets']);

      await this.loadMetadata();

      this.currentStorageSize = await this.calculateStorageSize();

      await this.cleanupOrphanedFiles();
    } catch (error) {
      console.error('Failed to initialize storage:', error);
      throw new Error('Storage initialization failed');
    }
  }

  /**
   * Calculate total size of cached assets
   */
  private async calculateStorageSize(): Promise<number> {
    let total = 0;
    for (const metadata of this.cache.values()) {
      if (metadata.status === 'cached') {
        try {
          total += await this.adapter.getFileSize(metadata.path);
        } catch (error) {
          console.warn(`Failed to get size for ${metadata.path}:`, error);
        }
      }
    }
    return total;
  }

  /**
   * Clean up any files not referenced in metadata
   */
  private async cleanupOrphanedFiles(): Promise<void> {
    const assetsDir = `${this.config.cachePath}/assets`;
    try {
      const directories = await this.adapter.listDirectory(assetsDir);
      const validPaths = new Set(Array.from(this.cache.values()).map((m) => m.path));

      for (const dir of directories) {
        const dirPath = `${assetsDir}/${dir}`;
        const files = await this.adapter.listDirectory(dirPath);

        for (const file of files) {
          const fullPath = `${dirPath}/${file}`;
          if (!validPaths.has(fullPath)) {
            await this.adapter.deleteFile(fullPath);
          }
        }

        const remainingFiles = await this.adapter.listDirectory(dirPath);
        if (remainingFiles.length === 0) {
          await this.adapter.deleteDirectory(dirPath, { recursive: true });
        }
      }
    } catch (error) {
      console.warn('Failed to cleanup orphaned files:', error);
    }
  }

  /**
   * Load metadata from storage
   */
  private async loadMetadata(): Promise<void> {
    try {
      const exists = await this.adapter.exists(`${CACHE_PATH}/metadata.json`);
      if (exists) {
        const data = await this.adapter.readFile(`${CACHE_PATH}/metadata.json`);
        const text = new TextDecoder().decode(data);
        const metadata = JSON.parse(text);
        this.cache = new Map(Object.entries(metadata));
      }
    } catch (error) {
      console.warn('Failed to load metadata:', error);
      this.cache.clear();
    }
  }

  /**
   * Save metadata to storage
   */
  private async saveMetadata(): Promise<void> {
    try {
      const metadata = Object.fromEntries(this.cache.entries());
      const data = new TextEncoder().encode(JSON.stringify(metadata, null, 2));
      await this.adapter.writeFile(`${CACHE_PATH}/metadata.json`, data.buffer);
    } catch (error) {
      console.error('Failed to save metadata:', error);
      throw error;
    }
  }

  /**
   * Request an asset from cache or download it
   */
  public async requestAsset(
    url: string,
    options: RequestOptions = {
      contentType: undefined,
    }
  ): Promise<{ data: ArrayBuffer; metadata: AssetMetadata }> {
    const cached = this.cache.get(url);
    if (cached?.status === 'cached') {
      try {
        const data = await this.adapter.readFile(cached.path);
        cached.lastAccessed = Date.now();
        await this.saveMetadata();
        return { data, metadata: cached };
      } catch (error) {
        console.warn(`Failed to read cached asset ${url}:`, error);
        cached.status = 'error';
        this.cache.delete(url);
        await this.saveMetadata();
      }
    }

    return this.queueDownload(url, options);
  }

  /**
   * Queue asset for download
   */
  private async queueDownload(
    url: string,
    options: RequestOptions
  ): Promise<{ data: ArrayBuffer; metadata: AssetMetadata }> {
    return new Promise((resolve, reject) => {
      const metadata = this.createMetadata(url, options);
      this.cache.set(url, metadata);
      this.downloadQueue.add(url);
      this.addDownloadListener(url, resolve, reject);

      if (!this.isProcessingQueue) {
        this.processDownloadQueue();
      }
    });
  }

  private readonly downloadListeners = new Map<
    string,
    Array<{
      resolve: (value: { data: ArrayBuffer; metadata: AssetMetadata }) => void;
      reject: (error: Error) => void;
    }>
  >();

  private addDownloadListener(
    url: string,
    resolve: (value: { data: ArrayBuffer; metadata: AssetMetadata }) => void,
    reject: (error: Error) => void
  ): void {
    const listeners = this.downloadListeners.get(url) || [];
    listeners.push({ resolve, reject });
    this.downloadListeners.set(url, listeners);
  }

  /**
   * Process download queue with priority handling
   */
  private async processDownloadQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.downloadQueue.size > 0) {
        const urls = Array.from(this.downloadQueue).sort((a, b) => {
          const prioA = this.cache.get(a)?.priority || 0;
          const prioB = this.cache.get(b)?.priority || 0;
          return prioB - prioA;
        });

        for (const url of urls) {
          const metadata = this.cache.get(url);
          if (!metadata) continue;

          try {
            metadata.status = 'downloading';
            const data = await this.downloadAsset(url);
            await this.saveToCache(url, data);
            this.downloadQueue.delete(url);
            this.notifyListeners(url, data);
          } catch (error) {
            metadata.status = 'error';
            this.notifyListeners(url, null, error as Error);
            this.downloadQueue.delete(url);
          }
        }
      }
    } finally {
      this.isProcessingQueue = false;
      await this.saveMetadata();
    }
  }

  /**
   * Download asset from URL with progress tracking
   */
  private async downloadAsset(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download asset: ${response.statusText}`);
    }

    const metadata = this.cache.get(url);
    if (metadata) {
      metadata.contentType = response.headers.get('content-type') || undefined;
    }

    return response.arrayBuffer();
  }

  /**
   * Save asset to cache with storage management
   */
  private async saveToCache(url: string, data: ArrayBuffer): Promise<void> {
    const metadata = this.cache.get(url);
    if (!metadata) return;

    if (this.currentStorageSize + data.byteLength > this.config.maxStorageSize) {
      await this.evictCache(data.byteLength);
    }

    const hash = await hashUrl(url);
    const extension = getFileExtension(metadata.contentType);
    const assetDir = this.getAssetDirPath(hash);
    const dirPath = assetDir.replace('./', '').split('/');
    await this.adapter.ensureDirectory(dirPath);

    const filePath = this.getAssetFilePath(hash, extension);

    await this.adapter.writeFile(filePath, data);

    metadata.path = filePath;
    metadata.size = data.byteLength;
    metadata.status = 'cached';
    this.currentStorageSize += data.byteLength;

    await this.saveMetadata();
  }

  /**
   * Evict least recently used entries to free up space
   */
  private async evictCache(requiredSpace: number): Promise<void> {
    const entries = Array.from(this.cache.entries())
      .filter(([, meta]) => meta.status === 'cached')
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

    let freedSpace = 0;
    for (const [url, metadata] of entries) {
      if (freedSpace >= requiredSpace) break;

      try {
        await this.adapter.deleteFile(metadata.path);

        const dirPath = metadata.path.substring(0, metadata.path.lastIndexOf('/'));
        const remainingFiles = await this.adapter.listDirectory(dirPath);
        if (remainingFiles.length === 0) {
          await this.adapter.deleteDirectory(dirPath, { recursive: true });
        }

        this.cache.delete(url);
        freedSpace += metadata.size;
        this.currentStorageSize -= metadata.size;
      } catch (error) {
        console.warn(`Failed to evict cache entry ${url}:`, error);
      }
    }

    await this.saveMetadata();
  }

  private notifyListeners(url: string, data: ArrayBuffer | null, error?: Error): void {
    const listeners = this.downloadListeners.get(url) || [];
    const metadata = this.cache.get(url);

    listeners.forEach(({ resolve, reject }) => {
      if (error || !data || !metadata) {
        reject(error || new Error('Download failed'));
      } else {
        resolve({ data, metadata });
      }
    });

    this.downloadListeners.delete(url);
  }

  /**
   * Create metadata for a new asset
   */
  private createMetadata(url: string, options: RequestOptions): AssetMetadata {
    return {
      url,
      path: '',
      size: 0,
      lastAccessed: Date.now(),
      status: 'queued',
      priority: options.priority ?? 0,
      contentType: options.contentType,
      partialContent: options.partial,
    };
  }

  /**
   * Clear all cached assets
   */
  public async clearCache(): Promise<void> {
    try {
      const assetDirs = await this.adapter.listDirectory(`${CACHE_PATH}/assets`);
      for (const dir of assetDirs) {
        await this.adapter.deleteDirectory(`${CACHE_PATH}/assets/${dir}`, { recursive: true });
      }

      this.cache.clear();
      this.currentStorageSize = 0;
      await this.saveMetadata();
    } catch (error) {
      console.error('Failed to clear cache:', error);
      throw new Error('Cache clearing failed');
    }
  }

  /**
   * Get storage statistics
   */
  public async getStorageStats(): Promise<StorageStats> {
    return this.adapter.getStorageStats();
  }

  /**
   * Get list of all cached assets
   * @returns {AssetMetadata[]} Array of all cached assets metadata
   */
  public getCachedAssets(): AssetMetadata[] {
    return Array.from(this.cache.values());
  }

  /**
   * Gets the asset directory path for a given hash
   * @param hash The hash value for the asset
   * @returns The full path to the asset directory
   */
  private getAssetDirPath(hash: string): string {
    return `${this.config.cachePath}/assets/${hash}`;
  }

  /**
   * Gets the asset file path for a given hash and extension
   * @param hash The hash value for the asset
   * @param extension The file extension
   * @returns The full path to the asset file
   */
  private getAssetFilePath(hash: string, extension: string): string {
    return `${this.getAssetDirPath(hash)}/${hash}.${extension}`;
  }

  /**
   * Cleanup method to be called when the manager is no longer needed
   * Terminates the worker to free up resources
   */
  public cleanup(): void {
    this.adapter.terminate();
  }
}
import { file, dir, write } from 'opfs-tools';
import { CACHE_PATH, ASSETS_PATH, METADATA_FILE, MAX_STORAGE_SIZE } from './constants';
import { AssetMetadata, CacheConfig, RequestOptions, StorageStats } from './types';
import { getFileExtension, hashUrl } from './utils';

/**
 * StorageManager class implementing singleton pattern for asset caching and retrieval
 * Uses opfs-tools library for file system operations
 */
export class StorageManager {
  private static instance: StorageManager;
  private readonly config: CacheConfig;
  private cache: Map<string, AssetMetadata>;
  private downloadQueue: Set<string>;
  private isProcessingQueue: boolean;
  private currentStorageSize: number;
  private readonly downloadListeners: Map<
    string,
    Array<{
      resolve: (value: { data: ArrayBuffer; metadata: AssetMetadata }) => void;
      reject: (error: Error) => void;
    }>
  >;

  /**
   * Private constructor to enforce singleton pattern
   * @param config Optional configuration overrides
   */
  private constructor(config?: Partial<CacheConfig>) {
    this.config = {
      maxStorageSize: MAX_STORAGE_SIZE,
      cachePath: CACHE_PATH,
      ...config,
    };
    this.cache = new Map();
    this.downloadQueue = new Set();
    this.isProcessingQueue = false;
    this.currentStorageSize = 0;
    this.downloadListeners = new Map();
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
      // Ensure directories exist
      await dir(this.config.cachePath).create();
      await dir(ASSETS_PATH).create();

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
          const fileSize = await file(metadata.path, 'r').getSize();
          total += fileSize;
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
    try {
      const assetsDir = dir(ASSETS_PATH);
      const validPaths = new Set(Array.from(this.cache.values()).map((m) => m.path));
      
      if (await assetsDir.exists()) {
        const directories = await assetsDir.children();
        
        for (const directory of directories) {
          if (directory.kind === 'dir') {
            const dirChildren = await directory.children();
            
            for (const child of dirChildren) {
              if (child.kind === 'file' && !validPaths.has(child.path)) {
                await child.remove();
              }
            }
            
            // Check if directory is empty after removing orphaned files
            const remainingChildren = await directory.children();
            if (remainingChildren.length === 0) {
              await directory.remove();
            }
          }
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
      const metadataFile = file(METADATA_FILE, 'r');
      
      if (await metadataFile.exists()) {
        const text = await metadataFile.text();
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
      const metadataJson = JSON.stringify(metadata, null, 2);
      await write(METADATA_FILE, metadataJson);
    } catch (error) {
      console.error('Failed to save metadata:', error);
      throw error;
    }
  }

  /**
   * Request an asset from cache or download it
   * @param url URL of the asset to request
   * @param options Request options
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
        const data = await file(cached.path, 'r').arrayBuffer();
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
   * @param url URL of the asset to download
   * @param options Request options
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

  /**
   * Add download listener for a URL
   * @param url URL to listen for
   * @param resolve Callback for successful download
   * @param reject Callback for failed download
   */
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
   * @param url URL of the asset to download
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
   * @param url URL of the asset
   * @param data Asset data to save
   */
  private async saveToCache(url: string, data: ArrayBuffer): Promise<void> {
    const metadata = this.cache.get(url);
    if (!metadata) return;

    if (this.currentStorageSize + data.byteLength > this.config.maxStorageSize) {
      await this.evictCache(data.byteLength);
    }

    const hash = await hashUrl(url);
    const extension = getFileExtension(metadata.contentType);
    const assetDirPath = this.getAssetDirPath(hash);
    
    await dir(assetDirPath).create();
    
    const filePath = this.getAssetFilePath(hash, extension);
    await write(filePath, data);

    metadata.path = filePath;
    metadata.size = data.byteLength;
    metadata.status = 'cached';
    this.currentStorageSize += data.byteLength;

    await this.saveMetadata();
  }

  /**
   * Evict least recently used entries to free up space
   * @param requiredSpace Space required in bytes
   */
  private async evictCache(requiredSpace: number): Promise<void> {
    const entries = Array.from(this.cache.entries())
      .filter(([, meta]) => meta.status === 'cached')
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

    let freedSpace = 0;
    for (const [url, metadata] of entries) {
      if (freedSpace >= requiredSpace) break;

      try {
        await file(metadata.path, 'r').remove();

        const dirPath = metadata.path.substring(0, metadata.path.lastIndexOf('/'));
        const dirChildren = await dir(dirPath).children();
        
        if (dirChildren.length === 0) {
          await dir(dirPath).remove();
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

  /**
   * Notify listeners of download completion or failure
   * @param url URL of the downloaded asset
   * @param data Downloaded data or null on failure
   * @param error Error if download failed
   */
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
   * @param url URL of the asset
   * @param options Request options
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
      const assetsDir = dir(ASSETS_PATH);
      if (await assetsDir.exists()) {
        const directories = await assetsDir.children();
        
        for (const directory of directories) {
          if (directory.kind === 'dir') {
            await directory.remove();
          }
        }
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
    const estimate = await navigator.storage.estimate();
    return {
      used: estimate.usage || 0,
      available: (estimate.quota || 0) - (estimate.usage || 0),
      total: estimate.quota || 0,
    };
  }

  /**
   * Get list of all cached assets
   * @returns Array of all cached assets metadata
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
}
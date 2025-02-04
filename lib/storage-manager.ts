import { AssetMetadata, CacheConfig, FileSystemAdapter, RequestOptions, StorageStats } from './types';
import { CACHE_PATH, CHUNK_SIZE, MAX_STORAGE_SIZE } from './constants';
import { OPFSAdapter } from './opfs-adapter';

/**
 * Manages asset caching and retrieval with priority-based downloading
 * and LRU cache eviction
 */
export class StorageManager {
  private static instance: StorageManager;
  private readonly adapter: FileSystemAdapter;
  private readonly config: CacheConfig;
  private readonly cache: Map<string, AssetMetadata>;
  private readonly downloadQueue: Set<string>;
  private currentStorageSize: number;
  private isProcessingQueue: boolean;

  constructor(config?: Partial<CacheConfig>) {
    this.adapter = new OPFSAdapter();
    this.config = {
      maxStorageSize: MAX_STORAGE_SIZE,
      cachePath: CACHE_PATH,
      chunkSize: CHUNK_SIZE,
      ...config,
    };
    this.cache = new Map();
    this.downloadQueue = new Set();
    this.currentStorageSize = 0;
    this.isProcessingQueue = false;
  }

  /**
   * Get singleton instance of StorageManager
   */
  public static getInstance(config?: Partial<CacheConfig>): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager(config);
    }

    console.debug('Use StorageManger: ', StorageManager.instance);
    return StorageManager.instance;
  }

  /**
   * Initialize the storage system
   */
  public async initialize(): Promise<void> {
    console.info('Initializing storage system...');
    try {
      const stats = await this.adapter.getStorageStats();
      this.currentStorageSize = stats.used;
      console.info('Storage system status: ', stats);
      await this.loadCacheMetadata();
    } catch (error) {
      console.error('Failed to initialize storage:', error);
      throw new Error('Storage initialization failed');
    }
  }

  /**
   * Request an asset from the cache or download it
   */
  public async requestAsset(
    url: string,
    options: RequestOptions = {}
  ): Promise<{ data: ArrayBuffer; metadata: AssetMetadata }> {
    return new Promise(async (resolve, reject) => {
      try {
        // Check if asset is already in cache
        const cached = this.cache.get(url);
        if (cached && cached.status === 'cached') {
          const data = await this.readFromCache(url);
          cached.lastAccessed = Date.now();
          resolve({ data, metadata: cached });
          return;
        }

        // Create or update metadata
        const metadata = this.createMetadata(url, options);
        this.cache.set(url, metadata);

        // If already downloading, wait for completion
        if (metadata.status === 'downloading') {
          this.addDownloadListener(url, resolve, reject);
          return;
        }

        // Queue the download
        metadata.status = 'queued';
        this.downloadQueue.add(url);
        this.addDownloadListener(url, resolve, reject);
        this.processDownloadQueue();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get statistics about storage usage
   */
  public async getStorageStats(): Promise<StorageStats> {
    return this.adapter.getStorageStats();
  }

  /**
   * Get list of all cached assets
   */
  public getCachedAssets(): AssetMetadata[] {
    return Array.from(this.cache.values());
  }

  /**
   * Clear all cached assets
   */
  public async clearCache(): Promise<void> {
    for (const [_, metadata] of this.cache.entries()) {
      if (metadata.status === 'cached') {
        await this.adapter.deleteFile(metadata.path);
      }
    }
    this.cache.clear();
    this.downloadQueue.clear();
    this.currentStorageSize = 0;
  }

  /**
   * Load cache metadata from storage
   */
  private async loadCacheMetadata(): Promise<void> {
    console.info('Loading cache metadata...');
    try {
      const metadataPath = `${this.config.cachePath}/metadata.json`;
      if (await this.adapter.exists(metadataPath)) {
        const data = await this.adapter.readFile(metadataPath);
        const metadata = JSON.parse(new TextDecoder().decode(data));
        console.debug('METADATA: ', metadata);
        Object.entries(metadata).forEach(([url, meta]) => {
          this.cache.set(url, meta as AssetMetadata);
        });
      }
    } catch (error) {
      console.warn('Failed to load cache metadata:', error);
    }
  }

  /**
   * Save cache metadata to storage
   */
  private async saveCacheMetadata(): Promise<void> {
    try {
      const metadata = Object.fromEntries(this.cache.entries());
      const data = new TextEncoder().encode(JSON.stringify(metadata));
      await this.adapter.writeFile(`${this.config.cachePath}/metadata.json`, data.buffer);
    } catch (error) {
      console.warn('Failed to save cache metadata:', error);
    }
  }

  /**
   * Process the download queue
   */
  async processDownloadQueue(): Promise<void> {
    if (this.isProcessingQueue || this.downloadQueue.size === 0) return;

    this.isProcessingQueue = true;
    try {
      const urls = Array.from(this.downloadQueue).sort((a, b) => {
        const prioA = this.cache.get(a)?.priority || 0;
        const prioB = this.cache.get(b)?.priority || 0;
        return prioB - prioA;
      });

      for (const url of urls) {
        const metadata = this.cache.get(url);
        if (!metadata || metadata.status === 'downloading') continue;

        try {
          metadata.status = 'downloading';
          const data = await this.downloadAsset(url, metadata);
          await this.saveToCache(url, data);
          this.downloadQueue.delete(url);
          this.notifyListeners(url, data);
        } catch (error) {
          metadata.status = 'error';
          this.notifyListeners(url, null, error as Error);
        }
      }
    } finally {
      this.isProcessingQueue = false;
      await this.saveCacheMetadata();
    }
  }

  /**
   * Calculate priority based on timestamp and other factors
   */
  private calculatePriority(options: RequestOptions): number {
    if (typeof options.priority === 'number') {
      return options.priority;
    }
    const timestamp = options.timestamp || 0;
    return Math.max(0, 1000 - timestamp);
  }

  /**
   * Create metadata for a new asset
   */
  private createMetadata(url: string, options: RequestOptions): AssetMetadata {
    const existing = this.cache.get(url);
    const status = existing?.status || 'queued';

    return {
      url,
      path: `${this.config.cachePath}/${this.hashUrl(url)}`,
      size: existing?.size || 0,
      lastAccessed: Date.now(),
      status,
      priority: this.calculatePriority(options),
      partialContent: options.partial,
    };
  }

  // Download helpers
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
   * Download asset from URL
   */
  async downloadAsset(url: string, metadata: AssetMetadata): Promise<ArrayBuffer> {
    const headers: HeadersInit = {};
    if (metadata.partialContent) {
      headers['Range'] = `bytes=${metadata.partialContent.start}-${metadata.partialContent.end}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to download asset: ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  /**
   * Save asset to cache
   */
  async saveToCache(url: string, data: ArrayBuffer): Promise<void> {
    const metadata = this.cache.get(url);
    if (!metadata) return;

    // Check if we need to free up space
    if (this.currentStorageSize + data.byteLength > this.config.maxStorageSize) {
      await this.evictCache(data.byteLength);
    }

    await this.adapter.writeFile(metadata.path, data);
    metadata.size = data.byteLength;
    metadata.status = 'cached';
    this.currentStorageSize += data.byteLength;
  }

  /**
   * Read asset from cache
   */
  async readFromCache(url: string): Promise<ArrayBuffer> {
    const metadata = this.cache.get(url);
    if (!metadata || metadata.status !== 'cached') {
      throw new Error('Asset not found in cache');
    }

    return this.adapter.readFile(metadata.path);
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
        this.cache.delete(url);
        freedSpace += metadata.size;
        this.currentStorageSize -= metadata.size;
      } catch (error) {
        console.error(`Failed to remove cache entry: ${url}`, error);
      }
    }
  }

  /**
   * Create a safe filename from URL using Web Crypto API
   * @private
   */
  private async hashUrl(url: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(url);

    // Generate SHA-256 hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    // Convert to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    // Take first 8 characters and add timestamp
    return `${hashHex.slice(0, 8)}-${Date.now()}`;
  }
}

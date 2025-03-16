import { file, dir, write } from 'opfs-tools';
import { MAX_STORAGE_SIZE, ROOT_PATH } from './constants';
import { AssetMetadata } from './types';
import { extractAssetId, getFileExtension } from './utils';

/**
 * StorageManager class implementing singleton pattern for asset caching and retrieval
 * Uses opfs-tools library for file system operations
 */
export class StorageManager {
  #rootDir: any; // OPFSDirWrap;
  #cache: Map<any, any> = new Map();
  #currentStorageSize: number = 0;
  #maxStorageSize: number = 0;
  #assetLocks: Map<any, any> = new Map();
  #initialized: boolean = false;
  #ongoingFetches = new Map<string, Promise<File>>();
  static #instance: StorageManager | null = null;

  constructor() {
    if (StorageManager.#instance) {
      return StorageManager.#instance;
    }

    this.#rootDir = dir(ROOT_PATH);
    this.#cache = new Map();
    this.#currentStorageSize = 0;
    this.#maxStorageSize = MAX_STORAGE_SIZE;
    this.#assetLocks = new Map();
    this.#initialized = false;
    StorageManager.#instance = this;
  }

  /**
   * Gets or creates the singleton instance of StorageManager
   * @returns The StorageManager instance
   */
  public static getInstance(): StorageManager {
    if (!StorageManager.#instance) {
      StorageManager.#instance = new StorageManager();
    }
    return StorageManager.#instance;
  }

  /**
   * Initializes the storage manager by creating the root directory
   * and loading cached asset metadata
   */
  async init(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    try {
      await this.#rootDir.create();
      const children = await this.#rootDir.children();

      for (const child of children) {
        if (child.kind === 'dir') {
          const assetId = child.name;
          const cacheMetadataPath = `${child.path}/cache-metadata.json`;

          try {
            const text = await file(cacheMetadataPath, 'r').text();
            const cacheMetadata: AssetMetadata = JSON.parse(text);
            this.#cache.set(assetId, cacheMetadata);
            this.#currentStorageSize += cacheMetadata.totalSize;
          } catch (err) {
            console.error(`Failed to load cache metadata from ${assetId}:`, err);
          }
        }
      }

      this.#initialized = true;
      console.info('StorageManager initialized successfully');
    } catch (err) {
      console.error('Failed to initialize StorageManager:', err);
      throw err;
    }
  }

  /**
   * Implements a locking mechanism to prevent race conditions
   * when accessing the same asset concurrently
   * @param assetId - The ID of the asset to lock
   * @param operation - The async operation to perform under the lock
   * @returns Promise resolving to the result of the operation
   */
  async #withLock<T>(assetId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#assetLocks.get(assetId) || Promise.resolve();
    const current = previous.then(() => operation());
    this.#assetLocks.set(
      assetId,
      current.then(
        () => {},
        () => {}
      ) // Prevent lock poisoning
    );
    return current;
  }

  /**
   * Adds an asset to the cache
   * @param assetId - Unique identifier for the asset
   * @param mainData - Asset data as ArrayBuffer
   * @param metadata - Asset metadata as object
   * @param contentType - MIME type of the asset
   */
  async addAsset(assetId: string, mainData: ArrayBuffer, metadata: object, contentType: string): Promise<void> {
    return this.#withLock(assetId, async () => {
      if (!this.#initialized) {
        await this.init();
      }

      const ext = getFileExtension(contentType);
      const assetDirPath = `${this.#rootDir.path}/${assetId}`;
      const mainFilePath = `${assetDirPath}/${assetId}.${ext}`;
      const metadataFilePath = `${assetDirPath}/${assetId}-meta.json`;
      const cacheMetadataPath = `${assetDirPath}/cache-metadata.json`;

      const metadataJson = JSON.stringify(metadata);
      const cacheMetadataTemp = { lastAccessed: Date.now(), totalSize: 0, mainFileExt: ext };
      const totalSize = mainData.byteLength + metadataJson.length + JSON.stringify(cacheMetadataTemp).length;

      if (this.#currentStorageSize + totalSize > this.#maxStorageSize) {
        await this.evictLRU(totalSize);
      }

      try {
        const assetDir = dir(assetDirPath);
        await assetDir.create();

        await write(mainFilePath, mainData);
        await write(metadataFilePath, metadataJson);

        const cacheMetadata: AssetMetadata = {
          lastAccessed: Date.now(),
          totalSize,
          mainFileExt: ext,
        };
        await write(cacheMetadataPath, JSON.stringify(cacheMetadata));

        this.#cache.set(assetId, cacheMetadata);
        this.#currentStorageSize += totalSize;
      } catch (err) {
        console.error('Failed to add asset:', assetId, err);
        throw err;
      }
    });
  }

  /**
   * Gets an asset from the cache, fetching it if not already cached
   * @param url - URL of the asset to get
   * @returns Promise resolving to the asset as a File object
   */
  async getAsset(url: string): Promise<File> {
    const assetId = extractAssetId(url);

    // Check if asset is already cached
    if (this.#cache.has(assetId)) {
      const metadata = this.#cache.get(assetId)!;
      const mainFilePath = `${this.#rootDir.path}/${assetId}/${assetId}.${metadata.mainFileExt}`;
      const opfsFile = file(mainFilePath, 'r');
      try {
        const originFile = await opfsFile.getOriginFile();
        if (originFile) {
          await this.updateLastAccessed(assetId);
          return originFile;
        }
      } catch (err) {
        console.error('Cached asset retrieval failed, refetching:', err);
      }
    }

    // Check for an ongoing fetch
    if (this.#ongoingFetches.has(assetId)) {
      return this.#ongoingFetches.get(assetId)!;
    }

    // Start a new fetch operation within a lock
    const fetchPromise = this.#withLock(assetId, async () => {
      // Double-check cache after acquiring lock to avoid race conditions
      if (this.#cache.has(assetId)) {
        const metadata = this.#cache.get(assetId)!;
        const mainFilePath = `${this.#rootDir.path}/${assetId}/${assetId}.${metadata.mainFileExt}`;
        const opfsFile = file(mainFilePath, 'r');
        const originFile = await opfsFile.getOriginFile();
        if (originFile) {
          await this.updateLastAccessed(assetId);
          return originFile;
        }
      }

      // Fetch and cache the asset
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
      }
      const data = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'video/mp4';
      const ext = getFileExtension(contentType);
      const metadata = {
        url,
        fetchedAt: new Date().toISOString(),
        contentType,
      };

      const assetDirPath = `${this.#rootDir.path}/${assetId}`;
      const mainFilePath = `${assetDirPath}/${assetId}.${ext}`;
      const metadataFilePath = `${assetDirPath}/${assetId}-meta.json`;
      const cacheMetadataPath = `${assetDirPath}/cache-metadata.json`;

      const metadataJson = JSON.stringify(metadata);
      const cacheMetadata = {
        lastAccessed: Date.now(),
        totalSize: data.byteLength + metadataJson.length,
        mainFileExt: ext,
      };

      // Ensure storage capacity
      const totalSize = cacheMetadata.totalSize + JSON.stringify(cacheMetadata).length;
      if (this.#currentStorageSize + totalSize > this.#maxStorageSize) {
        await this.evictLRU(totalSize);
      }

      // Write to OPFS
      const assetDir = dir(assetDirPath);
      await assetDir.create();
      await write(mainFilePath, data);
      await write(metadataFilePath, metadataJson);
      await write(cacheMetadataPath, JSON.stringify(cacheMetadata));

      // Update in-memory cache
      this.#cache.set(assetId, cacheMetadata);
      this.#currentStorageSize += totalSize;

      const opfsFile = file(mainFilePath, 'r');
      const originFile = await opfsFile.getOriginFile();
      if (!originFile) {
        throw new Error(`Failed to retrieve ${assetId} after caching`);
      }
      return originFile;
    });

    // Store the promise in the ongoing fetches map
    this.#ongoingFetches.set(assetId, fetchPromise);

    try {
      const file = await fetchPromise;
      return file;
    } finally {
      // Clean up after completion, whether successful or failed
      this.#ongoingFetches.delete(assetId);
    }
  }

  /**
   * Gets an asset from the cache by its ID without fetching if not found
   * @param assetId - ID of the asset to get
   * @returns Promise resolving to the asset as a File object
   */
  async getMainAsset(assetId: string): Promise<File> {
    if (!this.#initialized) {
      await this.init();
    }

    return this.#withLock(assetId, async () => {
      const metadata = this.#cache.get(assetId);
      if (!metadata) {
        throw new Error(`Asset not found: ${assetId}`);
      }

      const mainFilePath = `${this.#rootDir.path}/${assetId}/${assetId}.${metadata.mainFileExt}`;
      const opfsFile = file(mainFilePath, 'r');

      try {
        const originFile = await opfsFile.getOriginFile();
        if (!originFile) {
          throw new Error(`Failed to get origin file for ${assetId}`);
        }
        await this.updateLastAccessed(assetId);
        return originFile;
      } catch (err) {
        console.error('Error retrieving asset:', assetId, err);
        throw err;
      }
    });
  }

  /**
   * Gets the metadata associated with an asset
   * @param assetId - ID of the asset to get metadata for
   * @returns Promise resolving to the asset metadata
   */
  async getMetadata(assetId: string): Promise<object> {
    if (!this.#initialized) {
      await this.init();
    }

    return this.#withLock(assetId, async () => {
      const metadata = this.#cache.get(assetId);
      if (!metadata) {
        throw new Error(`Asset not found: ${assetId}`);
      }

      const metadataFilePath = `${this.#rootDir.path}/${assetId}/${assetId}-meta.json`;
      try {
        const text = await file(metadataFilePath, 'r').text();
        await this.updateLastAccessed(assetId);
        return JSON.parse(text);
      } catch (err) {
        console.error('Error reading metadata for asset:', assetId, err);
        throw err;
      }
    });
  }

  /**
   * Updates the last accessed timestamp for an asset
   * @param assetId - ID of the asset to update
   */
  private async updateLastAccessed(assetId: string): Promise<void> {
    const metadata = this.#cache.get(assetId);
    if (metadata) {
      metadata.lastAccessed = Date.now();
      const cacheMetadataPath = `${this.#rootDir.path}/${assetId}/cache-metadata.json`;
      await write(cacheMetadataPath, JSON.stringify(metadata));
    }
  }

  /**
   * Evicts least recently used assets to make space for new ones
   * @param requiredSpace - Amount of space needed in bytes
   */
  private async evictLRU(requiredSpace: number): Promise<void> {
    const entries = Array.from(this.#cache.entries()).sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    let freedSpace = 0;

    for (const [assetId, metadata] of entries) {
      if (freedSpace >= requiredSpace) break;
      await this.removeAsset(assetId);
      freedSpace += metadata.totalSize;
    }
  }

  /**
   * Removes an asset from the cache
   * @param assetId - ID of the asset to remove
   */
  private async removeAsset(assetId: string): Promise<void> {
    return this.#withLock(assetId, async () => {
      try {
        const assetDir = dir(`${this.#rootDir.path}/${assetId}`);
        await assetDir.remove();

        const metadata = this.#cache.get(assetId);
        if (metadata) {
          this.#currentStorageSize -= metadata.totalSize;
          this.#cache.delete(assetId);
        }
      } catch (err) {
        console.error('Error removing asset:', assetId, err);
        throw err;
      }
    });
  }

  /**
   * Returns information about all cached assets
   * @returns Array of asset information
   */
  async getCachedAssets(): Promise<Array<{ id: string; url: string }>> {
    if (!this.#initialized) {
      await this.init();
    }

    return Array.from(this.#cache.keys()).map((assetId) => ({
      id: assetId,
      url: `asset://${assetId}`,
    }));
  }

  /**
   * Clears all assets from the cache
   */
  async clearCache(): Promise<void> {
    const assetIds = Array.from(this.#cache.keys());

    for (const assetId of assetIds) {
      await this.removeAsset(assetId);
    }

    this.#currentStorageSize = 0;
  }
}

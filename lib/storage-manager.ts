import { file, dir, write } from 'opfs-tools';
import { MAX_STORAGE_SIZE, ROOT_PATH } from './constants';
import { AssetMetadata } from './types';
import { extractAssetId, getFileExtension } from './utils';

export class StorageManager {
  #rootDir: any;
  cache: Map<string, AssetMetadata> = new Map();
  #currentStorageSize: number = 0;
  #maxStorageSize: number = 0;
  #assetLocks: Map<string, Promise<any>> = new Map();
  #initialized: boolean = false;
  #initPromise!: Promise<void>;
  #ongoingFetches = new Map<string, Promise<File>>();
  static #instance: StorageManager | null = null;

  constructor() {
    if (StorageManager.#instance) {
      return StorageManager.#instance;
    }

    this.#rootDir = dir(ROOT_PATH);
    this.cache = new Map();
    this.#currentStorageSize = 0;
    this.#maxStorageSize = MAX_STORAGE_SIZE;
    this.#assetLocks = new Map();
    this.#initialized = false;
    
    this.#initPromise = this.#initializeInternal();
    
    StorageManager.#instance = this;
  }

  public static getInstance(): StorageManager {
    if (!StorageManager.#instance) {
      StorageManager.#instance = new StorageManager();
    }
    return StorageManager.#instance;
  }

  async init(): Promise<void> {
    return this.#initPromise;
  }
  
  async #initializeInternal(): Promise<void> {
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
            this.cache.set(assetId, cacheMetadata);
            this.#currentStorageSize += cacheMetadata.totalSize;
          } catch (err) {
            console.error(`Failed to load cache metadata from ${assetId}:`, err);
          }
        }
      }

      this.#initialized = true;
    } catch (err) {
      console.error('Failed to initialize StorageManager:', err);
      throw err;
    }
  }

  async #retryOperation<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const isRetryable = error instanceof Error && (
          error.message.includes("writer have not been closed") || 
          error.message.includes("failed to read") ||
          error.message.includes("failed to fetch") ||
          error.message.includes("The request is not allowed")
        );
        
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt >= maxRetries || !isRetryable) {
          throw lastError;
        }
        
        const delay = 200 * Math.pow(2, attempt);
        console.warn(`OPFS operation failed, retrying (${attempt + 1}/${maxRetries}) after ${delay}ms: ${lastError.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError || new Error('Unknown error in retry operation');
  }

  async #withLock<T>(assetId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#assetLocks.get(assetId) || Promise.resolve();
    const current = previous.then(() => this.#retryOperation(operation));
    this.#assetLocks.set(
      assetId,
      current.catch(() => {})
    );
    return current;
  }

  async addAsset(assetId: string, mainData: ArrayBuffer, metadata: object, contentType: string): Promise<void> {
    await this.#initPromise;
    
    return this.#withLock(assetId, async () => {
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

        this.cache.set(assetId, cacheMetadata);
        this.#currentStorageSize += totalSize;
      } catch (err) {
        console.error('Failed to add asset:', assetId, err);
        throw err;
      }
    });
  }

  async getAsset(url: string): Promise<File> {
    await this.#initPromise;
    
    const assetId = extractAssetId(url);
    
    if (this.#ongoingFetches.has(assetId)) {
      return this.#ongoingFetches.get(assetId)!;
    }

    const fetchPromise = this.#withLock(assetId, async () => {
      if (this.cache.has(assetId)) {
        try {
          const metadata = this.cache.get(assetId)!;
          const mainFilePath = `${this.#rootDir.path}/${assetId}/${assetId}.${metadata.mainFileExt}`;
          const opfsFile = file(mainFilePath, 'r');
          const originFile = await opfsFile.getOriginFile();
          
          if (originFile) {
            await this.updateLastAccessed(assetId);
            return originFile;
          }
        } catch (err) {
          console.warn('Cached asset retrieval failed, refetching:', err);
        }
      }

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

      const totalSize = cacheMetadata.totalSize + JSON.stringify(cacheMetadata).length;
      if (this.#currentStorageSize + totalSize > this.#maxStorageSize) {
        await this.evictLRU(totalSize);
      }

      const assetDir = dir(assetDirPath);
      await assetDir.create();

      await write(mainFilePath, data);
      await write(metadataFilePath, metadataJson);
      await write(cacheMetadataPath, JSON.stringify(cacheMetadata));

      this.cache.set(assetId, cacheMetadata);
      this.#currentStorageSize += totalSize;

      const opfsFile = file(mainFilePath, 'r');
      const originFile = await opfsFile.getOriginFile();
      if (!originFile) {
        throw new Error(`Failed to retrieve ${assetId} after caching`);
      }
      
      return originFile;
    });

    this.#ongoingFetches.set(assetId, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      this.#ongoingFetches.delete(assetId);
    }
  }

  async getMainAsset(assetId: string): Promise<File> {
    await this.#initPromise;

    return this.#withLock(assetId, async () => {
      const metadata = this.cache.get(assetId);
      if (!metadata) {
        throw new Error(`Asset not found: ${assetId}`);
      }

      const mainFilePath = `${this.#rootDir.path}/${assetId}/${assetId}.${metadata.mainFileExt}`;
      
      return this.#retryOperation(async () => {
        const opfsFile = file(mainFilePath, 'r');
        const originFile = await opfsFile.getOriginFile();
        if (!originFile) {
          throw new Error(`Failed to get origin file for ${assetId}`);
        }
        await this.updateLastAccessed(assetId);
        return originFile;
      });
    });
  }

  async getMetadata(assetId: string): Promise<object> {
    await this.#initPromise;

    return this.#withLock(assetId, async () => {
      const metadata = this.cache.get(assetId);
      if (!metadata) {
        throw new Error(`Asset not found: ${assetId}`);
      }

      const metadataFilePath = `${this.#rootDir.path}/${assetId}/${assetId}-meta.json`;
      
      return this.#retryOperation(async () => {
        const text = await file(metadataFilePath, 'r').text();
        await this.updateLastAccessed(assetId);
        return JSON.parse(text);
      });
    });
  }

  private async updateLastAccessed(assetId: string): Promise<void> {
    const metadata = this.cache.get(assetId);
    if (metadata) {
      metadata.lastAccessed = Date.now();
      const cacheMetadataPath = `${this.#rootDir.path}/${assetId}/cache-metadata.json`;
      
      await this.#retryOperation(async () => {
        await write(cacheMetadataPath, JSON.stringify(metadata));
      });
    }
  }

  private async evictLRU(requiredSpace: number): Promise<void> {
    const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    let freedSpace = 0;

    for (const [assetId, metadata] of entries) {
      if (freedSpace >= requiredSpace) break;
      await this.removeAsset(assetId);
      freedSpace += metadata.totalSize;
    }
  }

  private async removeAsset(assetId: string): Promise<void> {
    return this.#withLock(assetId, async () => {
      try {
        await this.#retryOperation(async () => {
          const assetDir = dir(`${this.#rootDir.path}/${assetId}`);
          await assetDir.remove();
        });

        const metadata = this.cache.get(assetId);
        if (metadata) {
          this.#currentStorageSize -= metadata.totalSize;
          this.cache.delete(assetId);
        }
      } catch (err) {
        console.error('Error removing asset:', assetId, err);
        throw err;
      }
    });
  }

  async getCachedAssets(): Promise<Array<{ id: string; url: string }>> {
    await this.#initPromise;

    return Array.from(this.cache.keys()).map((assetId) => ({
      id: assetId,
      url: `asset://${assetId}`,
    }));
  }

  async clearCache(): Promise<void> {
    await this.#initPromise;
    
    const assetIds = Array.from(this.cache.keys());
    for (const assetId of assetIds) {
      await this.removeAsset(assetId);
    }
    this.#currentStorageSize = 0;
  }
}
import { file, dir, write } from 'opfs-tools';
import { MAX_STORAGE_SIZE, ROOT_PATH } from './constants';
import { CacheMetadata } from './types';
import { extractAssetId, getFileExtension } from './utils';

/**
 * StorageManager class implementing singleton pattern for asset caching and retrieval
 * Uses opfs-tools library for file system operations
 */
export class StorageManager {
  #rootDir: any; // OPFSDirWrap;
  #cache: Map<any, any>;
  #currentStorageSize: number;
  #maxStorageSize: number;
  #assetLocks: Map<any, any>;

  constructor() {
    this.#rootDir = dir(ROOT_PATH);
    this.#cache = new Map();
    this.#currentStorageSize = 0;
    this.#maxStorageSize = MAX_STORAGE_SIZE;
    this.#assetLocks = new Map();
  }

  async init() {
    await this.#rootDir.create();
    const children = await this.#rootDir.children();
    for (const child of children) {
      if (child.kind === 'dir') {
        const assetId = child.name;
        const cacheMetadataPath = `${child.path}/cache-metadata.json`;

        try {
          const text = await file(cacheMetadataPath, 'r').text();
          const cacheMetadata: CacheMetadata = JSON.parse(text);
          this.#cache.set(assetId, cacheMetadata);
          this.#currentStorageSize += cacheMetadata.totalSize;
        } catch (err) {
          console.error(`Failed to load cache metadata from ${assetId}`);
        }
      }
    }
  }

  async #withLock<T>(assetId: string, operation: () => Promise<T>) {
    const previous = this.#assetLocks.get(assetId) || Promise.resolve();
    const current = previous.then(() => operation());
    this.#assetLocks.set(
      assetId,
      current.then(() => {})
    );

    return current;
  }

  async addAsset(assetId: string, mainData: ArrayBuffer, metadata: object, contentType: string) {
    console.debug('ADDING ASSET: ', assetId, mainData, metadata, contentType);
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

    await dir(assetDirPath).create();
    await write(mainFilePath, mainData);
    await write(metadataFilePath, metadataJson);

    const cacheMetadata: CacheMetadata = {
      lastAccessed: Date.now(),
      totalSize,
      mainFileExt: ext,
    };
    await write(cacheMetadataPath, JSON.stringify(cacheMetadata));

    this.#cache.set(assetId, cacheMetadata);
    this.#currentStorageSize += totalSize;

    return;
  }

  async getAsset(url: string): Promise<File> {
    const assetId = extractAssetId(url);
    console.debug('ASSET ID: ', assetId);
    return this.#withLock(assetId, async () => {
      // Step 1: Check if cached
      console.debug('HAS ASSET?? ', this.#cache.has(assetId));
      if (this.#cache.has(assetId)) {
        const metadata = this.#cache.get(assetId)!;
        const mainFilePath = `${this.#rootDir.path}/${assetId}/${assetId}.${metadata.mainFileExt}`;
        const opfsFile = file(mainFilePath, 'r');
        const originFile = await opfsFile.getOriginFile();
        if (!originFile) {
          throw new Error(`Failed to get origin file for ${assetId}`);
        }
        await this.updateLastAccessed(assetId);
        return originFile;
      }
      console.debug('nope fetch: ');
      // Step 2: If not cached, download the asset
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download asset from ${url}: ${response.statusText}`);
      }
      console.debug('OK: ');
      const data = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'video/mp4'; // Default to video/mp4 for this use case

      console.debug('save to opfs');
      // Step 3: Save to OPFS
      const metadata = {}; // Empty metadata for now; can be extended later
      await this.addAsset(assetId, data, metadata, contentType);

      console.debug('asset added');
      // Step 4: "Parse in memory" - for videos, we just need the File object
      const mainFilePath = `${this.#rootDir.path}/${assetId}/${assetId}.${getFileExtension(contentType)}`;
      const opfsFile = file(mainFilePath, 'r');
      const originFile = await opfsFile.getOriginFile();
      if (!originFile) {
        throw new Error(`Failed to get origin file for ${assetId} after saving`);
      }

      // Step 5: Return the asset
      return originFile;
    });
  }

  async getMainAsset(assetId: string): Promise<File> {
    return this.#withLock(assetId, async () => {
      const metadata = this.#cache.get(assetId);
      if (!metadata) {
        throw new Error(`Asset not found: ${assetId}`);
      }
      const mainFilePath = `${this.#rootDir.path}/${assetId}/${assetId}.${metadata.mainFileExt}`;
      const opfsFile = file(mainFilePath, 'r');
      const originFile = await opfsFile.getOriginFile();
      if (!originFile) {
        throw new Error(`Failed to get origin file for ${assetId}`);
      }
      await this.updateLastAccessed(assetId);
      return originFile;
    });
  }

  async getMetadata(assetId: string): Promise<object> {
    return this.#withLock(assetId, async () => {
      const metadata = this.#cache.get(assetId);
      if (!metadata) {
        throw new Error(`Asset not found: ${assetId}`);
      }
      const metadataFilePath = `${this.#rootDir.path}/${assetId}/${assetId}-metadata.json`;
      const text = await file(metadataFilePath, 'r').text();
      await this.updateLastAccessed(assetId);
      return JSON.parse(text);
    });
  }

  getCachedAssets(): Array<{url: string; size: number; contentType: string; lastAccessed: number}> {
    const assets = [];
    for (const [assetId, metadata] of this.#cache.entries()) {
      assets.push({
        url: `asset://${assetId}`,
        size: metadata.totalSize,
        contentType: `file/${metadata.mainFileExt}`, // Approximation based on extension
        lastAccessed: metadata.lastAccessed
      });
    }
    return assets;
  }

  async clearCache(): Promise<void> {
    const assetIds = Array.from(this.#cache.keys());
    for (const assetId of assetIds) {
      await this.removeAsset(assetId);
    }
    // Reset storage size counter
    this.#currentStorageSize = 0;
  }

  private async updateLastAccessed(assetId: string): Promise<void> {
    const metadata = this.#cache.get(assetId);
    if (metadata) {
      metadata.lastAccessed = Date.now();
      const cacheMetadataPath = `${this.#rootDir.path}/${assetId}/cache-metadata.json`;
      await write(cacheMetadataPath, JSON.stringify(metadata));
    }
  }

  private async evictLRU(requiredSpace: number): Promise<void> {
    const entries = Array.from(this.#cache.entries()).sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    let freedSpace = 0;
    for (const [assetId, metadata] of entries) {
      if (freedSpace >= requiredSpace) break;
      await this.removeAsset(assetId);
      freedSpace += metadata.totalSize;
    }
  }

  private async removeAsset(assetId: string): Promise<void> {
    return this.#withLock(assetId, async () => {
      const assetDir = dir(`${this.#rootDir.path}/${assetId}`);
      await assetDir.remove();
      const metadata = this.#cache.get(assetId);
      if (metadata) {
        this.#currentStorageSize -= metadata.totalSize;
        this.#cache.delete(assetId);
      }
    });
  }
}

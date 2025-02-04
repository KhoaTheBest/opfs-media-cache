import { AssetMetadata, CacheConfig, StorageStats } from './types';
import { CHUNK_SIZE, MAX_STORAGE_SIZE, ROOT_PATH } from './constants';

/**
 * Manages asset caching and retrieval with priority-based downloading
 * and LRU cache eviction
 */
export class CacheManager {
    private static instance: CacheManager;
  private root: FileSystemDirectoryHandle | null = null;
  private metadataFile = 'metadata.json';
  private assetsDir = 'assets';
  private initialized = false;
  private config: CacheConfig = {
    maxStorageSize: MAX_STORAGE_SIZE,
    cachePath: ROOT_PATH,
    chunkSize: CHUNK_SIZE
  };


  /**
   * Check if cache manager is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
  private config: CacheConfig = {
    maxStorageSize: 500 * 1024 * 1024, // 500MB default
    cachePath: '/',
    chunkSize: 1024 * 1024 // 1MB chunks
  };

  private constructor() {}

  /**
   * Get singleton instance of CacheManager
   */
  public static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  /**
   * Configure cache manager settings
   * @param config - Cache configuration options
   */
  public async configure(config: Partial<CacheConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    if (this.initialized) {
      await this.saveMetadata(); // Save updated config
    }
  }

  /**
   * Initialize the OPFS root directory and required structure
   */
  public async initialize(): Promise<boolean> {
    try {
      this.root = await navigator.storage.getDirectory();
      
      // Create assets directory if it doesn't exist
      const assetsHandle = await this.root.getDirectoryHandle(this.assetsDir, { create: true });
      
      // Initialize or load metadata
      await this.initializeMetadata();
      
      this.initialized = true;
      return true;
    } catch (err) {
      console.error('Failed to initialize OPFS:', err);
      return false;
    }
  }

  /**
   * Generate a unique asset ID
   * Creates a filesystem-safe ID with only alphanumeric characters and underscores
   */
  private generateAssetId(): string {
    // Use timestamp and random string, but ensure it's filesystem safe
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `asset_${timestamp}_${random}`.replace(/[^a-z0-9_]/gi, '_');
  }

  /**
   * Get asset path components from ID
   */
  /**
   * Get asset path components from ID
   * Ensures all paths are filesystem safe
   */
  private getAssetPaths(id: string, extension: string): {
    dirPath: string;
    filePath: string;
    thumbnailPath: string;
  } {
    // Clean up extension to ensure it starts with a dot and is filesystem safe
    const safeExtension = extension.startsWith('.') ? extension : `.${extension}`;
    const safeId = id.replace(/[^a-z0-9_]/gi, '_');
    
    const dirPath = `${this.assetsDir}/${safeId}`;
    return {
      dirPath,
      filePath: `${dirPath}/asset${safeExtension}`,
      thumbnailPath: `${dirPath}/thumbnail.webp`
    };
  }

  /**
   * Initialize or load metadata file
   */
  private async initializeMetadata(): Promise<void> {
    try {
      const fileHandle = await this.root!.getFileHandle(this.metadataFile, { create: true });
      const file = await fileHandle.getFile();
      
      if (file.size === 0) {
        // Initialize empty metadata
        await this.saveMetadata();
      }
    } catch (err) {
      console.error('Failed to initialize metadata:', err);
      throw err;
    }
  }

  /**
   * Save metadata to file
   */
  private async saveMetadata(): Promise<void> {
    if (!this.root) return;

    try {
      const fileHandle = await this.root.getFileHandle(this.metadataFile, { create: true });
      const writable = await fileHandle.createWritable();
      
      const metadata = {
        config: this.config,
        version: '1.0',
        lastUpdated: new Date().toISOString()
      };

      await writable.write(JSON.stringify(metadata, null, 2));
      await writable.close();
    } catch (err) {
      console.error('Failed to save metadata:', err);
      throw err;
    }
  }

  /**
   * Save an asset to cache
   * @param file - File to cache
   * @param metadata - Optional additional metadata
   * @returns Asset metadata if successful
   */
  public async saveAsset(
    file: File,
    metadata?: Partial<AssetMetadata>
  ): Promise<AssetMetadata | null> {
    if (!this.root) return null;

    try {
      const id = this.generateAssetId();
      // Get extension from filename or fallback to type
      const extension = file.name.split('.').pop() || 
                       (file.type ? `.${file.type.split('/').pop()}` : '.bin');
      const { dirPath, filePath } = this.getAssetPaths(id, extension);

      // Create asset directory
      const assetDir = await this.root.getDirectoryHandle(dirPath, { create: true });
      
      // Save main asset file
      const fileHandle = await assetDir.getFileHandle(`${id}.${extension}`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();

      // Create asset metadata
      const assetMetadata: AssetMetadata = {
        url: metadata?.url || '',
        path: filePath,
        size: file.size,
        lastAccessed: Date.now(),
        status: 'cached',
        priority: metadata?.priority || 1,
        contentType: file.type,
        ...metadata
      };

      // Save asset metadata
      await this.saveAssetMetadata(id, assetMetadata);

      return assetMetadata;
    } catch (err) {
      console.error('Failed to save asset:', err);
      return null;
    }
  }

  /**
   * Save metadata for specific asset
   */
  private async saveAssetMetadata(id: string, metadata: AssetMetadata): Promise<void> {
    const dirPath = this.getAssetPaths(id, '').dirPath;
    const metadataHandle = await this.root!.getFileHandle(`${dirPath}/metadata.json`, { create: true });
    const writable = await metadataHandle.createWritable();
    await writable.write(JSON.stringify(metadata, null, 2));
    await writable.close();
  }

  /**
   * Get asset by ID
   * @param id - Asset ID
   * @returns File object if found
   */
  public async getAsset(id: string): Promise<File | null> {
    if (!this.root) return null;

    try {
      // First get asset metadata to find the correct path
      const metadata = await this.getAssetMetadata(id);
      if (!metadata) return null;

      const pathParts = metadata.path.split('/');
      const fileName = pathParts.pop()!;
      const dirPath = pathParts.join('/');

      let current = this.root;
      for (const part of dirPath.split('/').filter(Boolean)) {
        current = await current.getDirectoryHandle(part);
      }

      const fileHandle = await current.getFileHandle(fileName);
      const file = await fileHandle.getFile();

      // Update last accessed time
      metadata.lastAccessed = Date.now();
      await this.saveAssetMetadata(id, metadata);

      return file;
    } catch (err) {
      console.error('Failed to get asset:', err);
      return null;
    }
  }

  /**
   * Get metadata for specific asset
   */
  private async getAssetMetadata(id: string): Promise<AssetMetadata | null> {
    try {
      const dirPath = this.getAssetPaths(id, '').dirPath;
      const metadataHandle = await this.root!.getFileHandle(`${dirPath}/metadata.json`);
      const file = await metadataHandle.getFile();
      const text = await file.text();
      return JSON.parse(text);
    } catch (err) {
      console.error('Failed to get asset metadata:', err);
      return null;
    }
  }

  /**
   * Delete asset by ID
   */
  public async deleteAsset(id: string): Promise<boolean> {
    if (!this.root) return false;

    try {
      const { dirPath } = this.getAssetPaths(id, '');
      await this.root.removeEntry(dirPath, { recursive: true });
      return true;
    } catch (err) {
      console.error('Failed to delete asset:', err);
      return false;
    }
  }

  /**
   * List all cached assets
   */
  public async listAssets(): Promise<AssetMetadata[]> {
    if (!this.root) return [];

    const assets: AssetMetadata[] = [];
    try {
      const assetsDir = await this.root.getDirectoryHandle(this.assetsDir);
      
      for await (const entry of assetsDir.values()) {
        if (entry.kind === 'directory') {
          const metadata = await this.getAssetMetadata(entry.name);
          if (metadata) {
            assets.push(metadata);
          }
        }
      }
    } catch (err) {
      console.error('Failed to list assets:', err);
    }

    return assets;
  }

  /**
   * Clear all cached assets
   */
  public async clearCache(): Promise<boolean> {
    if (!this.root) return false;

    try {
      const assetsDir = await this.root.getDirectoryHandle(this.assetsDir);
      for await (const entry of assetsDir.values()) {
        await assetsDir.removeEntry(entry.name, { recursive: true });
      }
      return true;
    } catch (err) {
      console.error('Failed to clear cache:', err);
      return false;
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
      total: estimate.quota || 0
    };
  }
}

// Export singleton instance
export const cacheManager = CacheManager.getInstance();
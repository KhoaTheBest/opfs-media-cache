export type CacheEntry = {
  path: string;
  size: number;
  lastAccessed: number;
  downloading: boolean;
  priority: number;
  partialContent?: {
    start: number;
    end: number;
  };
  listeners: Set<(data: ArrayBuffer) => void>;
};

/**
 * Status of an asset in the cache
 */
export type AssetStatus = 'downloading' | 'cached' | 'queued' | 'error';

/**
 * Configuration for the cache system
 */
export interface CacheConfig {
  maxStorageSize: number; // in bytes
  cachePath: string; // base path for cached files
  chunkSize?: number; // for partial content support
}

/**
 * Metadata about a cached asset
 */
export interface AssetMetadata {
  url: string;
  path: string;
  size: number;
  lastAccessed: number;
  status: AssetStatus;
  priority: number;
  contentType?: string;
  partialContent?: {
    start: number;
    end: number;
  };
}

/**
 * Asset request options
 */
export interface RequestOptions {
  contentType: string | undefined;
  timestamp?: number; // for priority calculation
  partial?: {
    start: number;
    end: number;
  };
  priority?: number; // override calculated priority
}

/**
 * Storage statistics
 */
export interface StorageStats {
  used: number;
  available: number;
  total: number;
}

/**
 * Interface for the file system adapter
 * This allows us to potentially swap out OPFS for another storage system
 */
export interface FileSystemAdapter {
  writeFile(path: string, data: ArrayBuffer): Promise<void>;
  readFile(path: string): Promise<ArrayBuffer>;
  deleteFile(path: string): Promise<void>;
  getFileSize(path: string): Promise<number>;
  exists(path: string): Promise<boolean>;
  getStorageStats(): Promise<StorageStats>;
  deleteDirectory(path: string, options?: { recursive?: boolean }): Promise<void>;
  listDirectory(path: string): Promise<string[]>;
  ensureDirectory(dirPath: string[]): Promise<void>;
}
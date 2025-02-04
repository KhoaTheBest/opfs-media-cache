import { StorageManager } from "../storage-manager";
import * as Comlink from 'comlink';
import { AssetMetadata, RequestOptions } from "../types";

export interface StorageEventMap {
  'queueStart': undefined;
  'queueComplete': undefined;
  'downloadProgress': { url: string; loaded: number; total: number };
  'downloadError': { url: string; error: Error };
}

export type StorageEventType = keyof StorageEventMap;
export type StorageEvent<K extends StorageEventType> = {
  type: K;
  detail: StorageEventMap[K];
};

class StorageManagerWithEvents extends StorageManager {
  private listeners = new Map<
    StorageEventType,
    Set<(event: StorageEvent<any>) => void>
  >();

  private static eventInstance: StorageManagerWithEvents;

  private constructor() {
    super();
  }

  public static getInstance(): StorageManagerWithEvents {
    if (!StorageManagerWithEvents.eventInstance) {
      StorageManagerWithEvents.eventInstance = new StorageManagerWithEvents();
    }
    return StorageManagerWithEvents.eventInstance;
  }

  emit<K extends StorageEventType>(type: K, detail: StorageEventMap[K]) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      const event: StorageEvent<K> = { type, detail };
      listeners.forEach((fn) => fn(event));
    }
  }

  addEventListener<K extends StorageEventType>(
    type: K,
    listener: (event: StorageEvent<K>) => void
  ) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)?.add(listener as (event: StorageEvent<any>) => void);
  }

  removeEventListener<K extends StorageEventType>(
    type: K,
    listener: (event: StorageEvent<K>) => void
  ) {
    this.listeners.get(type)?.delete(listener as (event: StorageEvent<any>) => void);
  }

  override async processDownloadQueue(): Promise<void> {
    this.emit('queueStart', undefined);
    try {
      await super.processDownloadQueue();
      this.emit('queueComplete', undefined);
    } catch (error) {
      this.emit('downloadError', {
        url: '',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  override async downloadAsset(url: string, metadata: AssetMetadata): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download asset: ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    let loaded = 0;

    // Create a ReadableStream to track progress
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      loaded += value.length;

      this.emit('downloadProgress', {
        url,
        loaded,
        total: total || loaded // If total is unknown, use loaded as total
      });
    }

    // Combine chunks into single ArrayBuffer
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result.buffer;
  }
}

// Get singleton instance
const instance = StorageManagerWithEvents.getInstance();

// Expose methods through Comlink
Comlink.expose({
  initialize: () => instance.initialize(),
  requestAsset: (url: string, options?: RequestOptions) =>
    instance.requestAsset(url, options),
  clearCache: () => instance.clearCache(),
  getCachedAssets: () => instance.getCachedAssets(),
  getStorageStats: () => instance.getStorageStats(),
  addEventListener: (type: StorageEventType, listener: (event: StorageEvent<any>) => void) =>
    instance.addEventListener(type, listener),
  removeEventListener: (type: StorageEventType, listener: (event: StorageEvent<any>) => void) =>
    instance.removeEventListener(type, listener),
});
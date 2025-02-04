import { AssetMetadata, RequestOptions } from "../types";
import * as Comlink from 'comlink';
import { StorageEvent, StorageEventType } from "./storage.worker";

type RemoteType = {
  initialize: () => Promise<void>;
  requestAsset: (
    url: string,
    options?: RequestOptions
  ) => Promise<{ data: ArrayBuffer; metadata: AssetMetadata }>;
  clearCache: () => Promise<void>;
  getCachedAssets: () => Promise<AssetMetadata[]>;
  getStorageStats: () => Promise<{ used: number; available: number; total: number }>;
  addEventListener: (
    type: StorageEventType,
    listener: (event: StorageEvent<StorageEventType>) => void
  ) => void;
  removeEventListener: (
    type: StorageEventType,
    listener: (event: StorageEvent<StorageEventType>) => void
  ) => void;
};

export class StorageManagerProxy {
  private worker: Worker;
  private remote: Comlink.Remote<RemoteType>;
  private eventListeners = new Map<
    (event: StorageEvent<any>) => void,
    (event: StorageEvent<any>) => void
  >();

  constructor() {
    this.worker = new Worker(new URL('./storage.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.remote = Comlink.wrap<RemoteType>(this.worker);
  }

  async initialize(): Promise<void> {
    return this.remote.initialize();
  }

  async requestAsset(
    url: string,
    options?: RequestOptions
  ): Promise<{ data: ArrayBuffer; metadata: AssetMetadata }> {
    return this.remote.requestAsset(url, options);
  }

  async clearCache(): Promise<void> {
    return this.remote.clearCache();
  }

  async getCachedAssets(): Promise<AssetMetadata[]> {
    return this.remote.getCachedAssets();
  }

  async getStorageStats(): Promise<{ used: number; available: number; total: number }> {
    return this.remote.getStorageStats();
  }

  on<K extends StorageEventType>(
    type: K,
    listener: (event: StorageEvent<K>) => void
  ): void {
    const wrappedListener = (event: StorageEvent<StorageEventType>) => {
      if (event.type === type) {
        listener(event as StorageEvent<K>);
      }
    };
    this.eventListeners.set(listener, wrappedListener);
    this.remote.addEventListener(type, Comlink.proxy(wrappedListener));
  }

  off<K extends StorageEventType>(
    type: K,
    listener: (event: StorageEvent<K>) => void
  ): void {
    const wrappedListener = this.eventListeners.get(listener);
    if (wrappedListener) {
      this.remote.removeEventListener(type, wrappedListener);
      this.eventListeners.delete(listener);
    }
  }

  dispose(): void {
    this.worker.terminate();
  }
}
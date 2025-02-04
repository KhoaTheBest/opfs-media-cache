import { StorageManagerProxy } from '../../lib/workers/main-thread-adapter';
import { AssetMetadata } from '../../lib/types';

// Test assets (sample images for demonstration)
const TEST_IMAGES = [
  'https://live.staticflickr.com/65535/54059628695_1ea1ba9e15_o_d.jpg',
  'https://live.staticflickr.com/65535/54202259495_3abaa12e11_o_d.jpg',
  'https://live.staticflickr.com/65535/53723475484_d6de5eefd1_o_d.jpg',
];

// Initialize UI elements
const addTestAssetBtn = document.getElementById('addTestAsset') as HTMLButtonElement;
const clearCacheBtn = document.getElementById('clearCache') as HTMLButtonElement;
const refreshViewBtn = document.getElementById('refreshView') as HTMLButtonElement;
const fileTree = document.getElementById('fileTree') as HTMLDivElement;
const notification = document.getElementById('notification') as HTMLDivElement;
const progress = document.getElementById('progress') as HTMLDivElement;
const progressFill = document.getElementById('progressFill') as HTMLDivElement;
const progressLabel = document.getElementById('progressLabel') as HTMLDivElement;

// Initialize StorageManagerProxy
const storageManager = new StorageManagerProxy();

// Initialize storage on load
await storageManager.initialize();

/**
 * Show notification message
 */
function showNotification(message: string, isError = false): void {
  notification.textContent = message;
  notification.style.background = isError ? '#f44336' : '#4CAF50';
  notification.style.display = 'block';

  setTimeout(() => {
    notification.style.display = 'none';
  }, 3000);
}

/**
 * Update progress bar
 */
function updateProgress(loaded: number, total: number): void {
  const percent = Math.round((loaded / total) * 100);
  progressFill.style.width = `${percent}%`;
  progressLabel.textContent = `Downloading... ${percent}%`;
}

/**
 * Render cached files
 */
function renderFileTree(entries: AssetMetadata[]): string {
  if (entries.length === 0) {
    return '<p>No files in cache</p>';
  }

  return entries
    .map((entry) => {
      const icon = '📄';
      const size = entry.size ? ` (${Math.round(entry.size / 1024)}KB)` : '';
      return `
        <div class="tree-item">
          <span class="file-name">
            ${icon} ${entry.url}${size}
          </span>
        </div>
      `;
    })
    .join('');
}

// Event listeners for StorageManagerProxy
storageManager.on('queueStart', () => {
  progress.style.display = 'block';
  progressFill.style.width = '0%';
});

storageManager.on('queueComplete', () => {
  progress.style.display = 'none';
});

storageManager.on('downloadProgress', ({ loaded, total }) => {
  updateProgress(loaded, total);
});

storageManager.on('downloadError', ({ url, error }) => {
  showNotification(`Failed to download ${url}: ${error.message}`, true);
  progress.style.display = 'none';
});

// Button event handlers
addTestAssetBtn.addEventListener('click', async () => {
  try {
    const url = TEST_IMAGES[Math.floor(Math.random() * TEST_IMAGES.length)];
    await storageManager.requestAsset(url);
    showNotification('Test asset cached successfully');
    // Refresh view after adding asset
    await refreshView();
  } catch (error) {
    showNotification('Failed to add test asset', true);
  }
});

clearCacheBtn.addEventListener('click', async () => {
  try {
    await storageManager.clearCache();
    showNotification('Cache cleared successfully');
    await refreshView();
  } catch (error) {
    showNotification('Failed to clear cache', true);
  }
});

async function refreshView(): Promise<void> {
  try {
    const cachedAssets = await storageManager.getCachedAssets();
    fileTree.innerHTML = renderFileTree(cachedAssets);
  } catch (error) {
    showNotification('Failed to refresh view', true);
  }
}

refreshViewBtn.addEventListener('click', refreshView);

// Initial view refresh
refreshView().catch(console.error);

// Cleanup on page unload
window.addEventListener('unload', () => {
  storageManager.dispose();
});
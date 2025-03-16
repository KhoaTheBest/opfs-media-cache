import { ROOT_PATH } from '../lib/constants';
import { StorageManager } from '../lib/storage-manager'; // Update path if needed
import { extractAssetId } from '../lib/utils'; // Import the utility function

// UI elements
const initCacheBtn = document.getElementById('initCache') as HTMLButtonElement;
const addTestAssetBtn = document.getElementById('addTestAsset') as HTMLButtonElement;
const clearCacheBtn = document.getElementById('clearCache') as HTMLButtonElement;
const refreshViewBtn = document.getElementById('refreshView') as HTMLButtonElement;
const fileDropZone = document.getElementById('fileDropZone') as HTMLDivElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const fileTree = document.getElementById('fileTree') as HTMLDivElement;
const notification = document.getElementById('notification') as HTMLDivElement;
const previewContent = document.getElementById('previewContent') as HTMLDivElement;

// Test assets
const TEST_IMAGE = [
  'https://live.staticflickr.com/65535/54059628695_1ea1ba9e15_o_d.jpg',
  'https://live.staticflickr.com/65535/54202259495_3abaa12e11_o_d.jpg',
  'https://live.staticflickr.com/65535/53723475484_d6de5eefd1_o_d.jpg',
];

// StorageManager instance
const storageManager = new StorageManager();

function showNotification(message: string, isError = false): void {
  notification.textContent = message;
  notification.style.background = isError ? '#f44336' : '#4CAF50';
  notification.style.display = 'block';
  setTimeout(() => (notification.style.display = 'none'), 3000);
}

async function previewFile(url: string): Promise<void> {
  previewContent.innerHTML = '';
  try {
    const file = await storageManager.getAsset(url);
    
    // Determine content type from the file
    const contentType = file.type || 'application/octet-stream';
    
    if (contentType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      previewContent.appendChild(img);
    } else if (contentType.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = URL.createObjectURL(file);
      video.controls = true;
      video.style.maxWidth = '100%';
      video.style.height = 'auto';
      previewContent.appendChild(video);
    } else if (contentType.startsWith('text/') || contentType === 'application/json') {
      const text = await file.text();
      const pre = document.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.overflow = 'auto';
      pre.style.maxHeight = '500px';
      pre.textContent = text;
      previewContent.appendChild(pre);
    } else {
      previewContent.innerHTML = `<p>File type "${contentType}" cannot be previewed.</p>`;
    }
  } catch (error) {
    console.error('Failed to preview file:', error);
    showNotification('Failed to preview file', true);
  }
}

// Inspect the internal cache by using the OPFS API directly
async function getCachedAssetsFromOPFS(): Promise<Array<{url: string; assetId: string}>> {
  try {
    const rootHandle = await window.navigator.storage.getDirectory();
    const rootDirPath = ROOT_PATH
    
    let rootDir;
    try {
      rootDir = await rootHandle.getDirectoryHandle(rootDirPath);
    } catch (e) {
      console.warn('Root directory not found:', e);
      return [];
    }
    
    const assetIds: string[] = [];
    
    // Iterate through all directory entries
    for await (const [name, entry] of rootDir.entries()) {
      if (entry.kind === 'directory') {
        assetIds.push(name);
      }
    }
    
    return assetIds.map(assetId => ({
      url: `asset://${assetId}`,
      assetId
    }));
  } catch (error) {
    console.error('Error reading cached assets:', error);
    return [];
  }
}

function renderFileTree(entries: Array<{url: string; assetId: string}>): string {
  return entries
    .map((entry) => {
      const icon = '📄';
      return `
      <div class="tree-item">
        <span class="file-name" data-url="${entry.url}" style="cursor: pointer;">
          ${icon} ${entry.assetId}
        </span>
      </div>
    `;
    })
    .join('');
}

fileTree.addEventListener('click', async (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('file-name')) {
    const url = target.dataset.url;
    if (url) await previewFile(url);
  }
});

// Get cached assets directly from OPFS
async function refreshView(): Promise<void> {
  try {
    const cachedAssets = await getCachedAssetsFromOPFS();
    console.log('Cached assets:', cachedAssets);
    fileTree.innerHTML = cachedAssets.length 
      ? renderFileTree(cachedAssets) 
      : '<p>No files in cache</p>';
  } catch (error) {
    console.error('Failed to refresh view:', error);
    showNotification('Failed to refresh view', true);
  }
}

// Clear cache by removing all asset directories from OPFS
async function clearCache(): Promise<void> {
  try {
    const rootHandle = await window.navigator.storage.getDirectory();
    const rootDirPath = ROOT_PATH
    
    try {
      // Remove the root directory completely
      await rootHandle.removeEntry(rootDirPath, { recursive: true });
      console.log('Root directory removed');
      
      // Recreate the root directory
      await rootHandle.getDirectoryHandle(rootDirPath, { create: true });
      console.log('Root directory recreated');
      
      // Reinitialize the storage manager
      await storageManager.init();
    } catch (e) {
      console.warn('Error during cache clearing:', e);
    }
    
  } catch (error) {
    console.error('Error clearing cache:', error);
    throw error;
  }
}

initCacheBtn.addEventListener('click', async () => {
  try {
    console.log('Initializing storage...');
    await storageManager.init();
    showNotification('Cache initialized successfully');
    initCacheBtn.disabled = true;
    addTestAssetBtn.disabled = false;
    clearCacheBtn.disabled = false;
    refreshViewBtn.disabled = false;
    fileDropZone.classList.remove('disabled');
    await refreshView();
  } catch (error) {
    console.error('Failed to initialize storage:', error);
    showNotification('Failed to initialize cache', true);
  }
});

addTestAssetBtn.addEventListener('click', async () => {
  try {
    const url = TEST_IMAGE[Math.floor(Math.random() * TEST_IMAGE.length)];
    await storageManager.getAsset(url);
    showNotification('Test asset cached successfully');
    await refreshView();
  } catch (error) {
    console.error('Failed to add test asset:', error);
    showNotification('Failed to add test asset', true);
  }
});

clearCacheBtn.addEventListener('click', async () => {
  try {
    console.log('Clearing cache...');
    await clearCache();
    showNotification('Cache cleared successfully');
    await refreshView();
  } catch (error) {
    console.error('Failed to clear cache:', error);
    showNotification('Failed to clear cache', true);
  }
});

refreshViewBtn.addEventListener('click', async () => {
  console.log('Refreshing view...');
  await refreshView();
});

fileDropZone.addEventListener('dragover', (e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  if (!fileDropZone.classList.contains('disabled')) fileDropZone.classList.add('drag-active');
});

fileDropZone.addEventListener('dragleave', (e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  fileDropZone.classList.remove('drag-active');
});

fileDropZone.addEventListener('drop', async (e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  fileDropZone.classList.remove('drag-active');
  if (fileDropZone.classList.contains('disabled')) return;
  const files = e.dataTransfer?.files;
  if (files) await handleFiles(Array.from(files));
});

fileDropZone.addEventListener('click', () => {
  if (!fileDropZone.classList.contains('disabled')) fileInput.click();
});

fileInput.addEventListener('change', async (e: Event) => {
  const files = (e.target as HTMLInputElement).files;
  if (files) await handleFiles(Array.from(files));
});

async function handleFiles(files: File[]): Promise<void> {
  for (const file of files) {
    try {
      // Get a buffer from the file
      const buffer = await file.arrayBuffer();
      
      // Generate a unique assetId
      const assetId = `local-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      
      // Use the addAsset method
      await storageManager.addAsset(
        assetId,
        buffer,
        {
          filename: file.name,
          timestamp: Date.now(),
        },
        file.type || 'application/octet-stream'
      );
      
      showNotification(`File ${file.name} cached successfully`);
    } catch (error) {
      console.error('Failed to cache file:', error);
      showNotification(`Failed to cache file ${file.name}`, true);
    }
  }
  await refreshView();
}
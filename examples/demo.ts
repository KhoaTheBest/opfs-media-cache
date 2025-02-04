import { StorageManager } from '../lib/storage-manager';
import { AssetMetadata } from '../lib/types';

// Initialize UI elements (unchanged)
const initCacheBtn = document.getElementById('initCache') as HTMLButtonElement;
const addTestAssetBtn = document.getElementById('addTestAsset') as HTMLButtonElement;
const clearCacheBtn = document.getElementById('clearCache') as HTMLButtonElement;
const refreshViewBtn = document.getElementById('refreshView') as HTMLButtonElement;
const fileDropZone = document.getElementById('fileDropZone') as HTMLDivElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const fileTree = document.getElementById('fileTree') as HTMLDivElement;
const notification = document.getElementById('notification') as HTMLDivElement;

// Test assets
const TEST_IMAGE = [
  'https://live.staticflickr.com/65535/54059628695_1ea1ba9e15_o_d.jpg',
  'https://live.staticflickr.com/65535/54202259495_3abaa12e11_o_d.jpg',
  'https://live.staticflickr.com/65535/53723475484_d6de5eefd1_o_d.jpg',
];

// Get StorageManager instance
const storageManager = StorageManager.getInstance();

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

const previewContent = document.getElementById('previewContent') as HTMLDivElement;

/**
 * Preview file content based on type
 */
async function previewFile(url: string): Promise<void> {
  const previewContent = document.getElementById('previewContent') as HTMLDivElement;

  if (!previewContent) {
    console.error('Preview content element not found.');
    showNotification('Failed to preview file: Missing preview container.', true);
    return;
  }

  // Clear previous content
  previewContent.innerHTML = '';

  try {
    const { data, metadata } = await storageManager.requestAsset(url);

    if (metadata.contentType?.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(new Blob([data]));
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      previewContent.appendChild(img);
    } else if (metadata.contentType?.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = URL.createObjectURL(new Blob([data]));
      video.controls = true;
      video.style.maxWidth = '100%';
      video.style.height = 'auto';
      previewContent.appendChild(video);
    } else if (metadata.contentType?.startsWith('text/') || metadata.contentType === 'application/json') {
      const text = new TextDecoder().decode(data);
      const pre = document.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.overflow = 'auto';
      pre.style.maxHeight = '500px';
      pre.textContent = text;
      previewContent.appendChild(pre);
    } else {
      previewContent.innerHTML = `<p>This file type cannot be previewed.</p>`;
    }
  } catch (error) {
    console.error('Failed to preview file:', error);
    showNotification('Failed to preview file', true);
  }
}

/**
 * Render cached files
 */
function renderFileTree(entries: AssetMetadata[]): string {
  return entries
    .map((entry) => {
      const icon = '📄';
      const size = entry.size ? ` (${Math.round(entry.size / 1024)}KB)` : '';
      return `
      <div class="tree-item">
        <span class="file-name" data-url="${entry.url}" style="cursor: pointer;">
          ${icon} ${entry.url}${size}
        </span>
      </div>
    `;
    })
    .join('');
}

// Add click handler for file names
fileTree.addEventListener('click', async (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('file-name')) {
    const url = target.dataset.url;
    if (url) {
      await previewFile(url);
    }
  }
});

/**
 * Refresh the file tree view
 */
async function refreshView(): Promise<void> {
  try {
    const cachedAssets = storageManager.getCachedAssets();
    console.log('Cached assets:', cachedAssets);

    fileTree.innerHTML = cachedAssets.length ? renderFileTree(cachedAssets) : '<p>No files in cache</p>';
  } catch (error) {
    console.error('Failed to refresh view:', error);
    showNotification('Failed to refresh view', true);
  }
}

// Event Handlers
initCacheBtn.addEventListener('click', async () => {
  try {
    console.log('Initializing storage...');
    await storageManager.initialize();
    showNotification('Cache initialized successfully');
    initCacheBtn.disabled = true;

    // Enable buttons after initialization
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
    console.log('Adding test asset...');
    const url = TEST_IMAGE[Math.floor(Math.random() * TEST_IMAGE.length)];
    await storageManager.requestAsset(url);
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
    await storageManager.clearCache();
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

// File Drop Zone Event Handlers
fileDropZone.addEventListener('dragover', (e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  if (!fileDropZone.classList.contains('disabled')) {
    fileDropZone.classList.add('drag-active');
  }
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

  if (fileDropZone.classList.contains('disabled')) {
    return;
  }

  const files = e.dataTransfer?.files;
  if (files) {
    await handleFiles(Array.from(files));
  }
});

// File Input Event Handler
fileDropZone.addEventListener('click', () => {
  if (!fileDropZone.classList.contains('disabled')) {
    fileInput.click();
  }
});

fileInput.addEventListener('change', async (e: Event) => {
  const files = (e.target as HTMLInputElement).files;
  if (files) {
    await handleFiles(Array.from(files));
  }
});

/**
 * Handle uploaded files by caching them
 * @param files Array of files to process
 */
async function handleFiles(files: File[]): Promise<void> {
  for (const file of files) {
    try {
      const url = URL.createObjectURL(file);
      await storageManager.requestAsset(url, {
        contentType: file.type,
        timestamp: Date.now(),
        priority: 1, // Give user uploads higher priority
      });
      URL.revokeObjectURL(url);
      showNotification(`File ${file.name} cached successfully`);
    } catch (error) {
      console.error('Failed to cache file:', error);
      showNotification(`Failed to cache file ${file.name}`, true);
    }
  }
  await refreshView();
}
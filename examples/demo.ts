// Types for OPFS entries
type FileTreeEntry = {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  type?: string;
  children?: FileTreeEntry[];
};

/**
 * OPFS Cache Manager - Singleton
 * Handles all OPFS (Origin Private File System) operations
 */
class CacheManager {
  private static instance: CacheManager;
  private root: FileSystemDirectoryHandle | null = null;
  private initialized = false;

  private constructor() {}

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  async getFile(path: string): Promise<File | null> {
    if (!this.root) return null;

    try {
      const parts = path.split('/').filter(Boolean);
      let current = this.root;

      // Navigate to the directory containing the file
      for (let i = 0; i < parts.length - 1; i++) {
        current = await current.getDirectoryHandle(parts[i]);
      }

      // Get the file
      const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
      return await fileHandle.getFile();
    } catch (err) {
      console.error('Failed to get file:', err);
      return null;
    }
  }

  /**
   * Initialize the OPFS root directory
   */
  async initialize(): Promise<boolean> {
    try {
      this.root = await navigator.storage.getDirectory();
      this.initialized = true;
      return true;
    } catch (err) {
      console.error('Failed to initialize OPFS:', err);
      return false;
    }
  }

  /**
   * Check if cache is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * List all files and directories recursively
   */
  async listContents(dir: FileSystemDirectoryHandle = this.root!, path = ''): Promise<FileTreeEntry[]> {
    const entries: FileTreeEntry[] = [];
    
    for await (const entry of dir.values()) {
      const fullPath = path ? `${path}/${entry.name}` : entry.name;
      
      if (entry.kind === 'directory') {
        const subEntries = await this.listContents(entry, fullPath);
        entries.push({
          name: entry.name,
          path: fullPath,
          kind: 'directory',
          children: subEntries
        });
      } else {
        const file = await (entry as FileSystemFileHandle).getFile();
        entries.push({
          name: entry.name,
          path: fullPath,
          kind: 'file',
          size: file.size,
          type: file.type
        });
      }
    }

    return entries;
  }

  /**
   * Save a test asset from URL
   */
  async saveTestAsset(url: string): Promise<boolean> {
    if (!this.root) return false;

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const filename = url.split('/').pop() || `test-${Date.now()}`;

      const fileHandle = await this.root.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      return true;
    } catch (err) {
      console.error('Failed to save test asset:', err);
      return false;
    }
  }

  /**
   * Save an uploaded file
   */
  async saveFile(file: File): Promise<boolean> {
    if (!this.root) return false;

    try {
      const fileHandle = await this.root.getFileHandle(file.name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();

      return true;
    } catch (err) {
      console.error('Failed to save file:', err);
      return false;
    }
  }

  /**
   * Clear all cache contents
   */
  async clearCache(): Promise<boolean> {
    if (!this.root) return false;

    try {
      for await (const entry of this.root.values()) {
        await this.root.removeEntry(entry.name, { recursive: true });
      }
      return true;
    } catch (err) {
      console.error('Failed to clear cache:', err);
      return false;
    }
  }
}

// Initialize UI elements
const initCacheBtn = document.getElementById('initCache') as HTMLButtonElement;
const addTestAssetBtn = document.getElementById('addTestAsset') as HTMLButtonElement;
const clearCacheBtn = document.getElementById('clearCache') as HTMLButtonElement;
const refreshViewBtn = document.getElementById('refreshView') as HTMLButtonElement;
const fileDropZone = document.getElementById('fileDropZone') as HTMLDivElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const fileTree = document.getElementById('fileTree') as HTMLDivElement;
const notification = document.getElementById('notification') as HTMLDivElement;

// Test assets
const TEST_IMAGE= [
  'https://live.staticflickr.com/65535/54059628695_1ea1ba9e15_o_d.jpg',
  'https://live.staticflickr.com/65535/54202259495_3abaa12e11_o_d.jpg',
  'https://live.staticflickr.com/65535/53723475484_d6de5eefd1_o_d.jpg'
];

// Get cache manager instance
const cacheManager = CacheManager.getInstance();

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

const previewPanel = document.createElement('div');
previewPanel.className = 'panel';
previewPanel.innerHTML = `
  <h2>File Preview</h2>
  <div id="previewContent"></div>
`;
document.body.appendChild(previewPanel);

const previewContent = document.getElementById('previewContent') as HTMLDivElement;

/**
 * Preview file content based on type
 */
async function previewFile(path: string): Promise<void> {
  const file = await cacheManager.getFile(path);
  if (!file) {
    showNotification('Failed to load file', true);
    return;
  }

  // Clear previous preview
  previewContent.innerHTML = '';

  try {
    if (file.type.startsWith('image/')) {
      // Image preview
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      previewContent.appendChild(img);
    } else if (file.type.startsWith('video/')) {
      // Video preview
      const video = document.createElement('video');
      video.src = URL.createObjectURL(file);
      video.controls = true;
      video.style.maxWidth = '100%';
      previewContent.appendChild(video);
    } else if (file.type.startsWith('text/') || file.type === 'application/json') {
      // Text preview
      const text = await file.text();
      const pre = document.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.overflow = 'auto';
      pre.style.maxHeight = '500px';
      pre.textContent = text;
      previewContent.appendChild(pre);
    } else {
      // Generic file info
      previewContent.innerHTML = `
        <div class="file-info">
          <p><strong>File Name:</strong> ${file.name}</p>
          <p><strong>Type:</strong> ${file.type || 'Unknown'}</p>
          <p><strong>Size:</strong> ${Math.round(file.size / 1024)}KB</p>
          <p>This file type cannot be previewed</p>
        </div>
      `;
    }
  } catch (err) {
    console.error('Failed to preview file:', err);
    showNotification('Failed to preview file', true);
  }
}

/**
 * Updated render file tree with clickable files
 */
function renderFileTree(entries: FileTreeEntry[]): string {
  return entries.map(entry => {
    const icon = entry.kind === 'directory' ? '📁' : '📄';
    const size = entry.size ? ` <span class="file-info">(${Math.round(entry.size / 1024)}KB)</span>` : '';
    
    const itemContent = entry.kind === 'file' 
      ? `<span class="file-name" data-path="${entry.path}" style="cursor: pointer;">${icon} ${entry.name}${size}</span>`
      : `${icon} ${entry.name}${size}`;

    return `
      <div class="tree-item">
        ${itemContent}
        ${entry.kind === 'directory' && entry.children?.length ? `
          <div class="tree-contents">
            ${renderFileTree(entry.children)}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// Add click handler for file names
fileTree.addEventListener('click', async (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('file-name')) {
    const path = target.dataset.path;
    if (path) {
      await previewFile(path);
    }
  }
});

// Add styles for preview
const style = document.createElement('style');
style.textContent = `
  #previewContent {
    padding: 15px;
    min-height: 200px;
    border: 1px solid #eee;
    border-radius: 4px;
  }

  .file-name {
    color: #2196F3;
    text-decoration: underline;
  }

  .file-name:hover {
    color: #1976D2;
  }

  .file-info {
    font-family: monospace;
    background: #f5f5f5;
    padding: 15px;
    border-radius: 4px;
  }

  pre {
    background: #f5f5f5;
    padding: 15px;
    border-radius: 4px;
    font-family: monospace;
  }
`;
document.head.appendChild(style);

/**
 * Refresh the file tree view
 */
async function refreshView(): Promise<void> {
  if (!cacheManager.isInitialized()) return;

  const entries = await cacheManager.listContents();
  fileTree.innerHTML = entries.length ? renderFileTree(entries) : '<p>No files in cache</p>';
}

// Event Handlers
initCacheBtn.addEventListener('click', async () => {
  const success = await cacheManager.initialize();
  if (success) {
    showNotification('Cache initialized successfully');
    initCacheBtn.disabled = true;
    addTestAssetBtn.disabled = false;
    clearCacheBtn.disabled = false;
    refreshViewBtn.disabled = false;
    fileDropZone.classList.remove('disabled');
    await refreshView();
  } else {
    showNotification('Failed to initialize cache', true);
  }
});

addTestAssetBtn.addEventListener('click', async () => {
  const url = TEST_IMAGE[Math.floor(Math.random() * TEST_IMAGE.length)];
  const success = await cacheManager.saveTestAsset(url);
  if (success) {
    showNotification('Test asset saved successfully');
    await refreshView();
  } else {
    showNotification('Failed to save test asset', true);
  }
});

clearCacheBtn.addEventListener('click', async () => {
  const success = await cacheManager.clearCache();
  if (success) {
    showNotification('Cache cleared successfully');
    await refreshView();
  } else {
    showNotification('Failed to clear cache', true);
  }
});

refreshViewBtn.addEventListener('click', () => refreshView());

// File upload handling
fileDropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (event: Event) => {
  const files = Array.from((event.target as HTMLInputElement).files || []);
  for (const file of files) {
    const success = await cacheManager.saveFile(file);
    showNotification(success ? 
      `${file.name} uploaded successfully` : 
      `Failed to upload ${file.name}`, !success);
  }
  await refreshView();
});

// Drag and drop handling
fileDropZone.addEventListener('dragover', (e: DragEvent) => {
  e.preventDefault();
  fileDropZone.classList.add('drag-active');
});

fileDropZone.addEventListener('dragleave', () => {
  fileDropZone.classList.remove('drag-active');
});

fileDropZone.addEventListener('drop', async (e: DragEvent) => {
  e.preventDefault();
  fileDropZone.classList.remove('drag-active');
  
  const files = Array.from(e.dataTransfer?.files || []);
  for (const file of files) {
    const success = await cacheManager.saveFile(file);
    showNotification(success ? 
      `${file.name} uploaded successfully` : 
      `Failed to upload ${file.name}`, !success);
  }
  await refreshView();
});


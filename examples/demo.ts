import { StorageManager } from '../lib/index';

let storageManager: StorageManager;
let chart: any;

const TEST_IMAGE_1 = 'https://apod.nasa.gov/apod/image/2411/MEDUSA_NEBULA_FINAL_BRS_SIGNED1024.jpg';
const TEST_IMAGE_2 = 'https://apod.nasa.gov/apod/image/2410/M16_HubbleWebbPisano_6500.jpg';
const TEST_IMAGE_3 = 'https://apod.nasa.gov/apod/image/2412/Pleiades_Pelizzo_9396.jpg';

const TEST_VIDEO_1 = 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4';
const TEST_VIDEO_2 = 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4';

// Keep track of ongoing downloads
const downloads = new Map();

// Initialize file upload handlers when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  setupFileUploadHandlers();
  setupTestButtons();
});

function setupFileUploadHandlers() {
  const dropZone = document.getElementById('fileDropZone');
  const fileInput = document.getElementById('fileInput') as HTMLInputElement;

  if (!dropZone || !fileInput) return;

  // Prevent default drag behaviors
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults);
    document.body.addEventListener(eventName, preventDefaults);
  });

  // Handle drop zone highlighting
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.add('drag-active');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.remove('drag-active');
    });
  });

  // Handle file drop
  dropZone.addEventListener('drop', (e: DragEvent) => {
    const files = e.dataTransfer?.files;
    if (files?.length) {
      handleLocalFiles(Array.from(files));
    }
  });

  // Handle file selection
  fileInput.addEventListener('change', (e: Event) => {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (files?.length) {
      handleLocalFiles(Array.from(files));
    }
  });

  // Handle click to upload
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });
}

function setupTestButtons() {
  // Add single test image
  const addImageBtn = document.getElementById('addImage') as HTMLButtonElement;
  addImageBtn?.addEventListener('click', () => {
    requestAsset(TEST_IMAGE_1);
  });

  // Test requesting same asset multiple times
  const addSameImageBtn = document.getElementById('addSameImage') as HTMLButtonElement;
  addSameImageBtn?.addEventListener('click', () => {
    for (let i = 0; i < 3; i++) {
      requestAsset(TEST_IMAGE_1);
    }
  });

  // Test multiple different assets
  const addMultipleBtn = document.getElementById('addMultiple') as HTMLButtonElement;
  addMultipleBtn?.addEventListener('click', () => {
    [TEST_IMAGE_1, TEST_IMAGE_2, TEST_IMAGE_3].forEach(url => requestAsset(url));
  });

  // Add test videos
  const addVideoBtn = document.getElementById('addVideo') as HTMLButtonElement;
  addVideoBtn?.addEventListener('click', () => {
    requestAsset(TEST_VIDEO_1);
  });
}

function preventDefaults(e: Event) {
  e.preventDefault();
  e.stopPropagation();
}

async function handleLocalFiles(files: File[]) {
  if (!storageManager) {
    showNotification('Please initialize storage first', true);
    return;
  }

  for (const file of files) {
    const fileId = `local-${Date.now()}-${file.name}`;
    
    if (downloads.has(fileId)) {
      showNotification(`${file.name} is already being processed`);
      continue;
    }

    try {
      const queueItem = createQueueItem(file.name);
      downloads.set(fileId, queueItem);

      const buffer = await file.arrayBuffer();
      const { data } = await storageManager.requestAsset(URL.createObjectURL(file), {
        onProgress: (progress) => updateProgress(fileId, progress),
        localFile: {
          arrayBuffer: buffer,
          contentType: file.type,
          filename: file.name
        }
      });

      showPreview(data, file.type);
      showNotification(`${file.name} uploaded successfully`);
      downloads.delete(fileId);
      updateUI();
    } catch (error) {
      console.error(`Failed to upload ${file.name}:`, error);
      showNotification(`Failed to upload ${file.name}`, true);
      downloads.delete(fileId);
    }
  }
}

async function requestAsset(url: string) {
  if (!storageManager) {
    showNotification('Please initialize storage first', true);
    return;
  }

  if (downloads.has(url)) {
    showNotification('Asset already downloading');
    return;
  }

  try {
    const queueItem = createQueueItem(url);
    downloads.set(url, queueItem);

    const { data, metadata } = await storageManager.requestAsset(url, {
      onProgress: (progress) => updateProgress(url, progress),
    });

    showPreview(data, metadata.contentType);
    showNotification('Asset downloaded successfully');
    downloads.delete(url);
    updateUI();
  } catch (error) {
    console.error('Failed to add asset:', error);
    showNotification('Failed to download asset', true);
    downloads.delete(url);
  }
}

function showPreview(data: ArrayBuffer, contentType: string) {
  const blob = new Blob([data], { type: contentType });
  const url = URL.createObjectURL(blob);
  const previewElement = document.getElementById('preview');
  
  if (!previewElement) return;

  if (contentType.startsWith('image/')) {
    previewElement.innerHTML = `<img src="${url}" style="max-width: 100%; max-height: 300px;">`;
  } else if (contentType.startsWith('video/')) {
    previewElement.innerHTML = `
      <video controls style="max-width: 100%; max-height: 300px;">
        <source src="${url}" type="${contentType}">
        Your browser does not support the video tag.
      </video>
    `;
  }
}

function createQueueItem(filename: string): HTMLElement {
  const queueList = document.getElementById('downloadQueue');
  const item = document.createElement('li');
  item.innerHTML = `
    ${filename}
    <div class="progress-bar">
      <div class="progress-fill"></div>
    </div>
  `;
  queueList?.appendChild(item);
  return item;
}

function updateProgress(id: string, progress: number) {
  const item = downloads.get(id);
  if (item) {
    const progressBar = item.querySelector('.progress-fill');
    if (progressBar instanceof HTMLElement) {
      progressBar.style.width = `${progress * 100}%`;
      if (progress === 1) {
        setTimeout(() => item.remove(), 1000);
      }
    }
  }
}

function showNotification(message: string, isError = false) {
  const notification = document.getElementById('notification');
  if (notification) {
    notification.textContent = message;
    notification.style.background = isError ? '#f44336' : '#4CAF50';
    notification.style.display = 'block';
    setTimeout(() => {
      notification.style.display = 'none';
    }, 3000);
  }
}

function updateUI() {
  // Update UI elements as needed
  // This could include updating storage statistics, cached assets list, etc.
}

// Initialize StorageManager
const initStorageBtn = document.getElementById('initStorage') as HTMLButtonElement;
initStorageBtn?.addEventListener('click', async () => {
  try {
    storageManager = StorageManager.getInstance();
    await storageManager.initialize();
    updateUI();
    
    // Enable all controls
    ['initStorage', 'addImage', 'addSameImage', 'addMultiple', 'addVideo'].forEach(id => {
      const element = document.getElementById(id) as HTMLButtonElement;
      if (element) element.disabled = id === 'initStorage';
    });
    
    const dropZone = document.getElementById('fileDropZone');
    if (dropZone) dropZone.classList.remove('disabled');
    
    showNotification('Storage initialized successfully');
  } catch (error) {
    console.error('Failed to initialize StorageManager:', error);
    showNotification('Failed to initialize storage', true);
  }
});

// Initialize UI - disable buttons initially
['addImage', 'addSameImage', 'addMultiple', 'addVideo'].forEach(id => {
  const element = document.getElementById(id) as HTMLButtonElement;
  if (element) element.disabled = true;
});
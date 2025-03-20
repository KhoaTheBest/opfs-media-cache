/**
 * Get file extension based on MIME type
 */
export function getFileExtension(contentType?: string): string {
  if (!contentType) return 'mp4';
  const mapping: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'video/mp4': 'mp4',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'text/plain': 'txt',
    'application/json': 'json',
    'application/pdf': 'pdf',
  };
  return mapping[contentType] || 'bin';
}

//@note for reviewer - do we need any url replacement logic?
export function extractAssetId(url: string) {
  const filename = url.split('/').pop() || '';
  const assetId = filename.split('.')[0];

  return assetId;
}

/**
 * Generates metadata for an asset based on its properties
 *
 * @param url - The original URL of the asset
 * @param file - The file object
 * @returns Asset metadata object
 */
export function generateAssetMetadata(url: string, file: File): object {
  return {
    url,
    contentType: file.type,
    size: file.size,
    name: file.name,
    lastModified: file.lastModified,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Converts a File to an ArrayBuffer
 *
 * @param file - The file to convert
 * @returns Promise resolving to the file data as ArrayBuffer
 */
export async function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
  return await file.arrayBuffer();
}

/**
 * Creates a File object from an ArrayBuffer with proper metadata
 *
 * @param buffer - The ArrayBuffer containing file data
 * @param name - The name for the file
 * @param contentType - The content type of the file
 * @returns A new File object
 */
export function arrayBufferToFile(
  buffer: ArrayBuffer,
  name: string,
  contentType: string = 'application/octet-stream'
): File {
  return new File([buffer], name, { type: contentType });
}

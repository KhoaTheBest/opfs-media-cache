/**
 * Get file extension based on MIME type
 */
export function getFileExtension(contentType?: string): string {
  if (!contentType) return 'mp4'; // Default to mp4 for videos if unknown
  const mapping: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'video/mp4': 'mp4',
    'text/plain': 'txt',
    'application/json': 'json',
  };
  return mapping[contentType] || 'mp4'; // Fallback to mp4 instead of bin
}

  //@note for reviewer - do we need any url replacement logic?
  export function extractAssetId(url: string) {
    const filename = url.split('/').pop() || ''
    const assetId = filename.split('.')[0]

    return assetId
  }
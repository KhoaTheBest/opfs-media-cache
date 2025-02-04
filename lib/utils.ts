/**
 * Get file extension based on MIME type
 */
export function getFileExtension(contentType?: string): string {
    if (!contentType) return 'bin';
    const mapping: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'video/mp4': 'mp4',
      'text/plain': 'txt',
      'application/json': 'json',
    };
    return mapping[contentType] || 'bin';
  }
  
  /**
   * Create a safe hash-based directory name for a URL
   */
  export async function hashUrl(url: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
  
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  }
  
  /**
   * Helper functions for path operations
   */
  export const PathUtils = {
    /**
     * Parse path into parent and name components
     * @param path File system path to parse
     */
    parsePath(path: string): { parent: string | null; name: string } {
      if (path === '/') return { parent: null, name: '' };
  
      const pathArr = path.split('/').filter((s) => s.length > 0);
      if (pathArr.length === 0) throw new Error('Invalid path');
  
      const name = pathArr[pathArr.length - 1];
      const parent = '/' + pathArr.slice(0, -1).join('/');
  
      return { name, parent };
    },
  
    /**
     * Join path segments safely
     * @param paths Path segments to join
     */
    join(...paths: string[]): string {
      return paths.join('/').replace(/\/+/g, '/');
    },
  };
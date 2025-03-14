/**
 * Get file extension based on MIME type
 */
export declare function getFileExtension(contentType?: string): string;
/**
 * Create a safe hash-based directory name for a URL
 */
export declare function hashUrl(url: string): Promise<string>;
/**
 * Helper functions for path operations
 */
export declare const PathUtils: {
    /**
     * Parse path into parent and name components
     * @param path File system path to parse
     */
    parsePath(path: string): {
        parent: string | null;
        name: string;
    };
    /**
     * Join path segments safely
     * @param paths Path segments to join
     */
    join(...paths: string[]): string;
};

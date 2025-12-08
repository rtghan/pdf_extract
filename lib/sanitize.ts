/**
 * File and path sanitization utilities
 * Prevents path traversal, XSS, and other filename-based attacks
 */

/**
 * Sanitize a filename to prevent security issues
 * - Removes path traversal sequences (../, ..\, etc.)
 * - Removes leading/trailing dots and spaces
 * - Removes control characters and null bytes
 * - Replaces problematic characters
 * - Limits length to prevent DoS
 * - Ensures valid extension if required
 */
export function sanitizeFilename(
  filename: string,
  options: {
    maxLength?: number;
    allowedExtensions?: string[];
  } = {}
): string {
  const { maxLength = 255, allowedExtensions } = options;

  if (!filename || typeof filename !== "string") {
    return "unnamed";
  }

  let sanitized = filename;

  // Remove null bytes and control characters (0x00-0x1F, 0x7F)
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, "");

  // Remove path traversal sequences
  sanitized = sanitized
    .replace(/\.\.\//g, "") // ../
    .replace(/\.\.\\/g, "") // ..\
    .replace(/\.\./g, "") // ..
    .replace(/^\.+/, "") // Leading dots
    .replace(/\.+$/, ""); // Trailing dots (except extension)

  // Remove or replace dangerous characters
  // Keep only alphanumeric, dash, underscore, dot, space, and common non-latin chars
  sanitized = sanitized.replace(/[<>:"/\\|?*]/g, "_");

  // Remove leading/trailing whitespace
  sanitized = sanitized.trim();

  // Replace multiple spaces/underscores with single
  sanitized = sanitized.replace(/\s+/g, " ");
  sanitized = sanitized.replace(/_+/g, "_");

  // Truncate to max length while preserving extension
  if (sanitized.length > maxLength) {
    const ext = getExtension(sanitized);
    const nameMaxLen = maxLength - ext.length - 1;
    const name = sanitized.slice(0, sanitized.length - ext.length - 1);
    sanitized = name.slice(0, nameMaxLen) + "." + ext;
  }

  // Validate extension if required
  if (allowedExtensions && allowedExtensions.length > 0) {
    const ext = getExtension(sanitized).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      // Replace with first allowed extension
      const name = sanitized.slice(0, sanitized.lastIndexOf(".")) || sanitized;
      sanitized = name + "." + allowedExtensions[0];
    }
  }

  // Ensure we have a valid filename
  if (!sanitized || sanitized === "." || sanitized === "..") {
    return "unnamed" + (allowedExtensions ? "." + allowedExtensions[0] : "");
  }

  return sanitized;
}

/**
 * Get file extension without the dot
 */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) return "";
  return filename.slice(lastDot + 1);
}

/**
 * Validate that a path doesn't contain traversal attempts
 * For use when paths come from database and we want extra safety
 */
export function isValidStoragePath(path: string): boolean {
  if (!path || typeof path !== "string") return false;

  // Check for path traversal
  if (
    path.includes("..") ||
    path.includes("./") ||
    path.includes(".\\") ||
    path.startsWith("/") ||
    path.startsWith("\\")
  ) {
    return false;
  }

  // Check for null bytes
  if (path.includes("\x00")) {
    return false;
  }

  // Should match expected format: {uuid}/{uuid}.{ext}
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const parts = path.split("/");

  if (parts.length !== 2) return false;

  const [userId, filename] = parts;
  if (!uuidPattern.test(userId)) return false;

  const filenameMatch = filename.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(pdf|md)$/i
  );
  if (!filenameMatch) return false;

  return true;
}

/**
 * Sanitize for use in Content-Disposition header
 * Escapes characters that could break the header
 */
export function sanitizeForContentDisposition(filename: string): string {
  // First apply general sanitization
  let sanitized = sanitizeFilename(filename);

  // Escape quotes and backslashes for header value
  sanitized = sanitized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  // Remove newlines that could break headers
  sanitized = sanitized.replace(/[\r\n]/g, "");

  return sanitized;
}

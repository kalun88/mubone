import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, extname } from "node:path";

const IMAGE_DIR = "dist/notion-images";

// Ensure the output directory exists
if (!existsSync(IMAGE_DIR)) {
  mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * Given a Notion S3 URL (which expires), download it to dist/notion-images/
 * and return the local path (e.g. "/notion-images/abc123.jpg").
 *
 * NOTE: We write directly to dist/ rather than public/ because Astro scans
 * the public/ folder before page rendering begins, so anything downloaded
 * during rendering would be missed. Writing to dist/ during rendering works
 * because Astro has already created dist/ by that point.
 *
 * Uses a hash of the URL path (without query params / auth tokens) as the
 * filename so the same image isn't downloaded twice across rebuilds.
 */
export async function downloadNotionImage(url: string): Promise<string> {
  // Extract just the path portion (before query string) to create a stable hash.
  // Notion S3 URLs look like:
  //   https://prod-files-secure.s3.us-west-2.amazonaws.com/.../<uuid>/<filename>?...
  // The path stays the same; the query params change on every API call.
  const urlObj = new URL(url);
  const stablePart = urlObj.pathname;

  const hash = createHash("md5").update(stablePart).digest("hex");

  // Try to infer extension from the URL path
  let ext = extname(urlObj.pathname).split("?")[0] || ".png";
  // Clean up common Notion extensions
  if (![".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif"].includes(ext.toLowerCase())) {
    ext = ".png";
  }

  const filename = `${hash}${ext}`;
  const localPath = join(IMAGE_DIR, filename);
  const publicPath = `/notion-images/${filename}`;

  // Skip download if already cached from a previous build
  if (existsSync(localPath)) {
    return publicPath;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to download image: ${response.status} ${url}`);
      return url; // Fall back to original URL
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(localPath, buffer);
    console.log(`Downloaded image: ${filename} (${(buffer.length / 1024).toFixed(0)} KB)`);
    return publicPath;
  } catch (error) {
    console.error(`Error downloading image from ${url}:`, error);
    return url; // Fall back to original URL
  }
}

/**
 * If the image is Notion-hosted (type "file"), download it and return
 * the local path. If external, return the URL as-is.
 */
export async function resolveImageUrl(
  type: string,
  fileUrl?: string,
  externalUrl?: string
): Promise<string> {
  if (type === "file" && fileUrl) {
    return await downloadNotionImage(fileUrl);
  }
  return externalUrl || fileUrl || "";
}

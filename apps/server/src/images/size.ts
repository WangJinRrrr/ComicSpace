import sharp from "sharp";

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Reads the pixel size of an already-written image file. Only the header is
 * parsed, so this is cheap enough to run for every cache write and lets the
 * reader reserve layout space before the image itself arrives.
 */
export async function probeImageSize(filePath: string): Promise<ImageSize | null> {
  try {
    const metadata = await sharp(filePath, { animated: false }).metadata();
    if (!metadata.width || !metadata.height) return null;
    return { width: metadata.width, height: metadata.height };
  } catch {
    return null;
  }
}

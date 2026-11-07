import type { ImageTransform } from "@comicspace/plugin-sdk";
import sharp from "sharp";
import { AppError } from "../lib/errors.js";

/** Raw decode above this size is refused to keep memory bounded. */
const MAX_PIXELS = 50_000_000;

export interface TransformedImage {
  buffer: Buffer;
  mime: string;
  /** Pixel size, so callers can record it for layout reservation. */
  width?: number;
  height?: number;
}

const FORMAT_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Applies a plugin-declared image operation. Sources that store full pages as
 * reordered horizontal bands (for example JMComic) use this to hand the proxy
 * and the download worker bytes the reader can actually display.
 */
export async function applyImageTransform(
  buffer: Buffer,
  mime: string,
  transform: ImageTransform | undefined,
): Promise<TransformedImage> {
  if (!transform) return { buffer, mime };

  if (transform.type !== "band-reverse") {
    throw new AppError(502, "unsupported", "Unknown image transform");
  }

  const bands = Math.trunc(transform.bands);
  if (!Number.isFinite(bands) || bands < 2) {
    return { buffer, mime };
  }

  const image = sharp(buffer, { animated: false });
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    throw new AppError(502, "parse_error", "Image has no usable dimensions");
  }
  if (width * height > MAX_PIXELS) {
    throw new AppError(502, "unsupported", "Image is too large to transform");
  }

  // GIFs are not band-scrambled by these sources, and re-encoding would drop
  // animation. Leave them untouched.
  if (metadata.format === "gif") {
    return { buffer, mime };
  }

  const format = metadata.format ?? "";
  if (!FORMAT_MIME[format]) {
    throw new AppError(
      502,
      "unsupported",
      `Image transform does not support ${format || "this format"}`,
    );
  }
  if (height < bands) {
    return { buffer, mime };
  }

  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const rowBytes = width * channels;
  const bandHeight = Math.floor(height / bands);
  const remainder = height % bands;
  const output = Buffer.alloc(data.length);

  // The scrambled image stores its bands bottom-first when decoded. The extra
  // remainder rows sit at the bottom of the stored image, so the first output
  // band is taller than the rest.
  let destinationRow = 0;
  for (let index = 0; index < bands; index += 1) {
    const bandRows = index === 0 ? bandHeight + remainder : bandHeight;
    const sourceRow = height - bandHeight * (index + 1) - remainder;
    data.copy(
      output,
      destinationRow * rowBytes,
      sourceRow * rowBytes,
      (sourceRow + bandRows) * rowBytes,
    );
    destinationRow += bandRows;
  }

  const encoder = sharp(output, {
    raw: { width, height, channels },
  });
  switch (format) {
    case "jpeg":
      encoder.jpeg({ quality: 90 });
      break;
    case "png":
      encoder.png({ compressionLevel: 6 });
      break;
    case "webp":
      // Pages are re-encoded on first read; effort 0 keeps that fast without a
      // visible quality drop for manga line art.
      encoder.webp({ quality: 90, effort: 0 });
      break;
  }

  return {
    buffer: await encoder.toBuffer(),
    mime: FORMAT_MIME[format] as string,
    width,
    height,
  };
}

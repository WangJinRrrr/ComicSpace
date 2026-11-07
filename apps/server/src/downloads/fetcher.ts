import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ImageTransform } from "@comicspace/plugin-sdk";
import { AppError } from "../lib/errors.js";
import { getGlobalProxyDispatcher } from "../lib/network.js";
import {
  fetchRemoteImage,
  limitImageStream,
  resolveImageMime,
} from "../images/fetch.js";
import type { ImageHostPolicy } from "../images/guard.js";
import { applyImageTransform } from "../images/transform.js";

export interface DownloadedImage {
  filePath: string;
  mime: string;
  bytes: number;
}

export async function downloadImageToFile(
  input: {
    url: string;
    headers?: Record<string, string>;
    policy: ImageHostPolicy;
    filePath: string;
    signal?: AbortSignal;
    transform?: ImageTransform;
  },
): Promise<DownloadedImage> {
  const response = await fetchRemoteImage(input.url, {
    headers: input.headers,
    policy: input.policy,
    signal: input.signal,
    dispatcher: getGlobalProxyDispatcher(),
  });
  if (!response.body) {
    throw new AppError(502, "network_error", "Remote image had no body", {
      retryable: true,
    });
  }
  const remoteMime =
    resolveImageMime(response.headers.get("content-type"), input.url) ??
    "application/octet-stream";
  const tempPath = `${input.filePath}.part`;
  await fs.promises.mkdir(path.dirname(input.filePath), { recursive: true });

  try {
    if (input.transform) {
      const limited = response.body.pipeThrough(limitImageStream());
      const raw = Buffer.from(await new Response(limited).arrayBuffer());
      const transformed = await applyImageTransform(
        raw,
        remoteMime,
        input.transform,
      );
      await fs.promises.writeFile(tempPath, transformed.buffer);
      await fs.promises.rename(tempPath, input.filePath);
      return {
        filePath: input.filePath,
        mime: transformed.mime,
        bytes: transformed.buffer.byteLength,
      };
    }

    await pipeline(
      Readable.fromWeb(
        response.body.pipeThrough(limitImageStream()) as never,
      ),
      fs.createWriteStream(tempPath),
    );
    const stat = await fs.promises.stat(tempPath);
    await fs.promises.rename(tempPath, input.filePath);
    return { filePath: input.filePath, mime: remoteMime, bytes: stat.size };
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

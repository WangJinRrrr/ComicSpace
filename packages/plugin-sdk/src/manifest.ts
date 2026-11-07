import type { ConfigField } from "./config";
import type { ReadingDirection } from "./models";

export const MANIFEST_VERSION = 1 as const;
export const PLUGIN_API_VERSION = 1 as const;

export interface PluginManifest {
  manifestVersion: typeof MANIFEST_VERSION;
  apiVersion: typeof PLUGIN_API_VERSION;
  /** Must equal the plugin folder name. */
  id: string;
  name: string;
  version: string;
  /** Relative path inside the plugin folder. */
  entry: string;
  description?: string;
  author?: string;
  languages?: string[];
  readingDirection?: ReadingDirection;
  /** Exact hostnames or patterns with `*` (e.g. "*.example.com"); omit to allow any public host. */
  allowedImageHosts?: string[];
  /** Default headers for covers; per-page headers take precedence. */
  imageHeaders?: Record<string, string>;
  config?: ConfigField[];
  rateLimit?: {
    maxConcurrency?: number;
    minIntervalMs?: number;
  };
}

import {
  PluginError,
  type Chapter,
  type FilterDef,
  type Manga,
  type Page,
  type PagedResult,
  type PluginManifest,
} from "@comicspace/plugin-sdk";
import { z } from "zod";

const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:/i.test(value), "Must be an http(s) URL");

const configOptionSchema = z
  .object({
    label: z.string().min(1).max(100),
    value: z.string().min(1).max(200),
  })
  .strict();

export const configFieldSchema = z.discriminatedUnion("type", [
  z
    .object({
      key: z.string().min(1).max(80),
      label: z.string().min(1).max(100),
      type: z.enum(["string", "password", "url"]),
      required: z.boolean().optional(),
      default: z.string().optional(),
      placeholder: z.string().max(200).optional(),
      description: z.string().max(500).optional(),
    })
    .strict(),
  z
    .object({
      key: z.string().min(1).max(80),
      label: z.string().min(1).max(100),
      type: z.literal("number"),
      required: z.boolean().optional(),
      default: z.number().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      description: z.string().max(500).optional(),
    })
    .strict(),
  z
    .object({
      key: z.string().min(1).max(80),
      label: z.string().min(1).max(100),
      type: z.literal("boolean"),
      default: z.boolean().optional(),
      description: z.string().max(500).optional(),
    })
    .strict(),
  z
    .object({
      key: z.string().min(1).max(80),
      label: z.string().min(1).max(100),
      type: z.literal("select"),
      options: z.array(configOptionSchema).min(1).max(200),
      required: z.boolean().optional(),
      default: z.string().optional(),
      description: z.string().max(500).optional(),
    })
    .strict(),
]);

export const manifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    apiVersion: z.literal(1),
    id: z
      .string()
      .min(2)
      .max(64)
      .regex(
        /^[a-z0-9][a-z0-9_-]*$/,
        "id must be lowercase letters, digits, _ or -",
      ),
    name: z.string().min(1).max(100),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+].*)?$/, "Must be semver"),
    entry: z.string().min(1).max(500),
    description: z.string().max(2000).optional(),
    author: z.string().max(200).optional(),
    languages: z.array(z.string().min(1).max(20)).max(20).optional(),
    readingDirection: z.enum(["rtl", "ltr", "ttb"]).optional(),
    allowedImageHosts: z.array(z.string().min(1).max(255)).max(100).optional(),
    imageHeaders: z.record(z.string(), z.string()).optional(),
    config: z.array(configFieldSchema).max(50).optional(),
    rateLimit: z
      .object({
        maxConcurrency: z.number().int().min(1).max(16).optional(),
        minIntervalMs: z.number().int().min(0).max(60000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (manifest.config) {
      const keys = new Set<string>();
      for (const field of manifest.config) {
        if (keys.has(field.key)) {
          ctx.addIssue({
            code: "custom",
            message: `Duplicate config key: ${field.key}`,
            path: ["config"],
          });
        }
        keys.add(field.key);
      }
    }
  });

const mangaStatusSchema = z.enum([
  "ongoing",
  "completed",
  "hiatus",
  "cancelled",
  "unknown",
]);

export const mangaSchema = z.object({
  id: z.string().min(1).max(2048),
  title: z.string().trim().min(1).max(1000),
  altTitles: z.array(z.string().max(1000)).max(100).optional(),
  coverUrl: httpUrl.optional(),
  description: z.string().max(100000).optional(),
  authors: z.array(z.string().max(300)).max(100).optional(),
  artists: z.array(z.string().max(300)).max(100).optional(),
  genres: z.array(z.string().max(200)).max(200).optional(),
  status: mangaStatusSchema.optional(),
  year: z.number().int().min(1000).max(3000).optional(),
  originalLanguage: z.string().max(30).optional(),
  readingDirection: z.enum(["rtl", "ltr", "ttb"]).optional(),
  chapterCount: z.number().int().min(0).max(100000).optional(),
  updatedAt: z.string().max(100).optional(),
  url: httpUrl.optional(),
});

export const chapterSchema = z.object({
  id: z.string().min(1).max(2048),
  title: z.string().trim().min(1).max(1000),
  number: z.number().finite().optional(),
  volume: z.string().max(100).optional(),
  language: z.string().max(30).optional(),
  group: z.string().max(300).optional(),
  publishedAt: z.string().max(100).optional(),
  pageCount: z.number().int().min(0).max(100000).optional(),
});

export const imageTransformSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("band-reverse"),
      bands: z.number().int().min(2).max(64),
    })
    .strict(),
]);

export const pageSchema = z.object({
  url: httpUrl,
  width: z.number().int().positive().max(100000).optional(),
  height: z.number().int().positive().max(100000).optional(),
  mimeType: z.string().max(100).optional(),
  referer: z.string().max(4000).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  transform: imageTransformSchema.optional(),
});

export function pagedMangaSchema() {
  return z.object({
    items: z.array(mangaSchema).max(100),
    page: z.number().int().min(1),
    hasNextPage: z.boolean(),
    total: z.number().int().min(0).optional(),
  });
}

export const filterDefSchema = z.discriminatedUnion("type", [
  z.object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(100),
    type: z.literal("text"),
    placeholder: z.string().max(200).optional(),
    default: z.string().optional(),
  }),
  z.object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(100),
    type: z.literal("select"),
    options: z.array(configOptionSchema).min(1).max(200),
    default: z.string().optional(),
  }),
  z.object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(100),
    type: z.literal("multi-select"),
    options: z.array(configOptionSchema).min(1).max(200),
    default: z.array(z.string()).optional(),
  }),
  z.object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(100),
    type: z.literal("boolean"),
    default: z.boolean().optional(),
  }),
  z.object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(100),
    type: z.literal("number"),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    default: z.number().optional(),
  }),
  z.object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(100),
    type: z.literal("sort"),
    options: z.array(configOptionSchema).min(1).max(200),
    default: z.string().optional(),
  }),
]);

export const chaptersSchema = z.array(chapterSchema).max(10000);
export const pagesSchema = z.array(pageSchema).max(5000);
export const filtersSchema = z.array(filterDefSchema).max(100);

function issueMessage(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
    .join("; ");
}

export function validateManifest(raw: unknown): PluginManifest {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginError(
      "parse_error",
      `Invalid plugin.json: ${issueMessage(parsed.error)}`,
    );
  }
  return parsed.data as PluginManifest;
}

export function validateManga(raw: unknown): Manga {
  const parsed = mangaSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginError(
      "parse_error",
      `Invalid manga result: ${issueMessage(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function validatePagedManga(raw: unknown): PagedResult<Manga> {
  const parsed = pagedMangaSchema().safeParse(raw);
  if (!parsed.success) {
    throw new PluginError(
      "parse_error",
      `Invalid browse/search result: ${issueMessage(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function validateChapters(raw: unknown): Chapter[] {
  const parsed = chaptersSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginError(
      "parse_error",
      `Invalid chapter list: ${issueMessage(parsed.error)}`,
    );
  }
  const seen = new Set<string>();
  return parsed.data.filter((chapter) => {
    if (seen.has(chapter.id)) return false;
    seen.add(chapter.id);
    return true;
  });
}

export function validatePages(raw: unknown): Page[] {
  const parsed = pagesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginError(
      "parse_error",
      `Invalid page list: ${issueMessage(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function validateFilters(raw: unknown): FilterDef[] {
  const parsed = filtersSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginError(
      "parse_error",
      `Invalid filter definitions: ${issueMessage(parsed.error)}`,
    );
  }
  return parsed.data as FilterDef[];
}

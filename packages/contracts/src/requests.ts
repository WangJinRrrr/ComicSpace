import { z } from "zod";

export const sourceIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

export const pageSchema = z.coerce.number().int().min(1).max(100000).default(1);

export const filterValuesSchema = z
  .record(
    z.string(),
    z.union([
      z.string(),
      z.array(z.string()),
      z.boolean(),
      z.number(),
      z.undefined(),
    ]),
  )
  .default({});

export const browseRequestSchema = z.object({
  page: pageSchema,
  filters: filterValuesSchema.optional(),
});

export const searchRequestSchema = z.object({
  term: z.string().trim().max(200).default(""),
  page: pageSchema,
  filters: filterValuesSchema.optional(),
});

export const configUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  values: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional(),
});

export const mangaQuerySchema = z.object({
  sourceId: sourceIdSchema,
  mangaId: z.string().min(1).max(2048),
  refresh: z.coerce.boolean().optional(),
});

export const chaptersQuerySchema = mangaQuerySchema;

export const pagesQuerySchema = z.object({
  sourceId: sourceIdSchema,
  mangaId: z.string().min(1).max(2048),
  chapterId: z.string().min(1).max(2048),
  refresh: z.coerce.boolean().optional(),
});

export const libraryAddSchema = z.object({
  sourceId: sourceIdSchema,
  mangaId: z.string().min(1).max(2048),
});

export const libraryRemoveQuerySchema = libraryAddSchema;

export const progressUpdateSchema = z.object({
  sourceId: sourceIdSchema,
  mangaId: z.string().min(1).max(2048),
  chapterId: z.string().min(1).max(2048),
  pageIndex: z.number().int().min(0).max(100000),
  mode: z.enum(["single", "double", "webtoon"]),
  completed: z.boolean().optional(),
});

export const downloadCreateSchema = z.object({
  sourceId: sourceIdSchema,
  mangaId: z.string().min(1).max(2048),
  chapterIds: z.array(z.string().min(1).max(2048)).min(1).max(50),
});

const proxyUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Proxy URL must be an http:// or https:// URL");

export const settingsUpdateSchema = z.object({
  imageExtraAllowedHosts: z
    .array(z.string().trim().min(1).max(255))
    .max(100)
    .optional(),
  cacheLimitMb: z.number().int().min(128).max(10240).optional(),
  proxyUrl: proxyUrlSchema.optional(),
});

export const downloadIdParamSchema = z.coerce.number().int().positive();
export const downloadPageIdParamSchema = z.coerce.number().int().positive();

export type BrowseRequest = z.infer<typeof browseRequestSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type PagesQuery = z.infer<typeof pagesQuerySchema>;
export type ProgressUpdateRequest = z.infer<typeof progressUpdateSchema>;
export type DownloadCreateRequest = z.infer<typeof downloadCreateSchema>;

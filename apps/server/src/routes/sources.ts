import type { Hono } from "hono";
import type {
  ConfigFieldDto,
  SourceConfigDto,
} from "@comicspace/contracts";
import { configUpdateSchema, sourceIdSchema } from "@comicspace/contracts";
import type { ConfigValues } from "@comicspace/plugin-sdk";
import type { AppContext } from "../context.js";
import { badRequest, notFound } from "../lib/errors.js";
import { ok, parseJson } from "../lib/http.js";
import {
  resolveConfig,
} from "../plugins/config.js";
import { getPluginConfig, savePluginConfig } from "../db/repos/config.js";
import { syncSourceAccount } from "../services/accountSync.js";
import { listSources } from "../services/sources.js";

function maskConfig(
  sourceId: string,
  fields: ConfigFieldDto[],
  values: ConfigValues,
  enabled: boolean,
): SourceConfigDto {
  const secretKeys: string[] = [];
  const masked: SourceConfigDto["values"] = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.type === "password") {
      if (value !== undefined && value !== null && value !== "") {
        secretKeys.push(field.key);
        masked[field.key] = null;
      }
      continue;
    }
    if (value !== undefined) masked[field.key] = value;
  }
  return { sourceId, enabled, values: masked, secretKeys };
}

function coerceConfig(
  fields: ConfigFieldDto[],
  incoming: Record<string, string | number | boolean | null>,
  existing: ConfigValues,
): ConfigValues {
  const next: ConfigValues = { ...existing };
  for (const field of fields) {
    if (!(field.key in incoming)) continue;
    const raw = incoming[field.key];
    if (raw === null) {
      delete next[field.key];
      continue;
    }
    if (field.type === "number") {
      const value = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value)) {
        throw badRequest(`${field.label} must be a number`);
      }
      if (field.min !== undefined && value < field.min) {
        throw badRequest(`${field.label} must be at least ${field.min}`);
      }
      if (field.max !== undefined && value > field.max) {
        throw badRequest(`${field.label} must be at most ${field.max}`);
      }
      next[field.key] = value;
    } else if (field.type === "boolean") {
      next[field.key] = Boolean(raw);
    } else if (field.type === "select") {
      const value = String(raw);
      if (!field.options.some((option) => option.value === value)) {
        throw badRequest(`${field.label} has an invalid value`);
      }
      next[field.key] = value;
    } else {
      next[field.key] = String(raw);
    }
  }
  return next;
}

export function registerSourceRoutes(app: Hono, context: AppContext): void {
  app.get("/api/sources", async (c) => {
    return ok(c, await listSources(context.registry, context.db));
  });

  app.post("/api/sources/reload", async (c) => {
    await context.registry.reload();
    return ok(c, await listSources(context.registry, context.db));
  });

  app.get("/api/sources/:id/config", async (c) => {
    const sourceId = sourceIdSchema.safeParse(c.req.param("id"));
    if (!sourceId.success) throw badRequest("Invalid source id");
    const plugin = await context.registry.getPlugin(sourceId.data);
    if (!plugin) throw notFound("Unknown source");
    const stored = getPluginConfig(context.db, plugin.id);
    const resolved = resolveConfig(plugin.manifest, stored.values);
    const fields = (plugin.manifest.config ?? []) as ConfigFieldDto[];
    return ok(
      c,
      maskConfig(plugin.id, fields, resolved.values, stored.enabled),
    );
  });

  app.put("/api/sources/:id/config", async (c) => {
    const sourceId = sourceIdSchema.safeParse(c.req.param("id"));
    if (!sourceId.success) throw badRequest("Invalid source id");
    const plugin = await context.registry.getPlugin(sourceId.data);
    if (!plugin) throw notFound("Unknown source");
    const body = await parseJson(c, configUpdateSchema);
    const stored = getPluginConfig(context.db, plugin.id);
    const fields = (plugin.manifest.config ?? []) as ConfigFieldDto[];
    const values = coerceConfig(fields, body.values ?? {}, stored.values);
    const saved = savePluginConfig(
      context.db,
      plugin.id,
      values,
      body.enabled ?? stored.enabled,
    );
    const resolved = resolveConfig(plugin.manifest, saved.values);
    return ok(
      c,
      maskConfig(plugin.id, fields, resolved.values, saved.enabled),
    );
  });

  app.post("/api/sources/:id/sync-account", async (c) => {
    const sourceId = sourceIdSchema.safeParse(c.req.param("id"));
    if (!sourceId.success) throw badRequest("Invalid source id");
    return ok(c, await syncSourceAccount(
      { db: context.db, registry: context.registry },
      sourceId.data,
    ));
  });
}

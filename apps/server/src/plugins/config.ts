import type {
  ConfigValues,
  PluginManifest,
} from "@comicspace/plugin-sdk";

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export interface ResolvedConfig {
  values: ConfigValues;
  missing: string[];
}

export function resolveConfig(
  manifest: PluginManifest,
  stored: ConfigValues,
): ResolvedConfig {
  const values: ConfigValues = { ...stored };
  const missing: string[] = [];

  for (const field of manifest.config ?? []) {
    if (!(field.key in values) && field.default !== undefined) {
      values[field.key] = field.default as ConfigValues[string];
    }
    const required = "required" in field ? field.required === true : false;
    if (required && isEmptyValue(values[field.key])) {
      missing.push(field.key);
    }
  }

  return { values, missing };
}

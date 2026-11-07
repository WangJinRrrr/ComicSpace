import path from "node:path";
import { fileURLToPath } from "node:url";
import { PluginLoader } from "../apps/server/src/plugins/loader.js";

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const pluginsDir = path.resolve(
    root,
    process.env.COMICSPACE_PLUGINS_DIR || "plugins",
  );

  const loader = new PluginLoader({
    pluginsDir,
    sdkEntry: path.join(root, "packages/plugin-sdk/runtime.mjs"),
  });
  const scan = await loader.scan({ forceReload: true });

  for (const plugin of scan.plugins) {
    console.log(
      `✓ ${plugin.id} v${plugin.manifest.version} — ${plugin.manifest.name}`,
    );
    console.log(
      `  search=${plugin.capabilities.search} browse=${plugin.capabilities.browse} filters=${plugin.capabilities.filters} accountSync=${plugin.capabilities.accountSync}`,
    );
  }

  for (const failure of scan.failures) {
    console.error(`✗ ${failure.sourceId}: ${failure.message}`);
  }

  if (scan.failures.length > 0) process.exit(1);
  if (scan.plugins.length === 0) {
    console.log(`No plugins found in ${pluginsDir}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

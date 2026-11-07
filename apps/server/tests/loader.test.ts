import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginLoader } from "../src/plugins/loader.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixtureRoot(): string {
  return path.resolve(process.cwd(), "../..");
}

function loaderFor(pluginsDir: string): PluginLoader {
  return new PluginLoader({
    pluginsDir,
    sdkEntry: path.join(fixtureRoot(), "packages/plugin-sdk/runtime.mjs"),
  });
}

describe("plugin loader", () => {
  it("loads the fixture plugin with jiti and derives capabilities", async () => {
    const root = fixtureRoot();
    const loader = loaderFor(path.join(root, "tests/fixtures/plugins"));
    const scan = await loader.scan({ forceReload: true });
    expect(scan.failures).toEqual([]);
    const plugin = scan.plugins.find((item) => item.id === "mock-source");
    expect(plugin).toBeDefined();
    expect(plugin?.capabilities).toEqual({
      search: true,
      browse: true,
      filters: true,
      accountSync: false,
    });
    expect(plugin?.manifest.name).toBe("Mock Source");
  });

  it("loads the released mangacopy plugin and does not advertise account sync", async () => {
    const root = fixtureRoot();
    const scan = await loaderFor(path.join(root, "plugins")).scan({
      forceReload: true,
    });
    const failure = scan.failures.find((item) => item.sourceId === "mangacopy");
    expect(failure).toBeUndefined();
    const plugin = scan.plugins.find((item) => item.id === "mangacopy");
    expect(plugin?.manifest).toMatchObject({
      id: "mangacopy",
      name: "拷贝漫画",
      version: "0.1.0",
      entry: "index.ts",
    });
    expect(plugin?.capabilities).toMatchObject({
      search: true,
      browse: true,
      filters: true,
      accountSync: false,
    });
    expect(typeof plugin?.impl.pullAccount).toBe("undefined");
  });

  it("isolates an invalid plugin without breaking valid ones", async () => {
    const root = fixtureRoot();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comicspace-plugins-"));
    tempDirs.push(dir);
    fs.cpSync(
      path.join(root, "tests/fixtures/plugins/mock-source"),
      path.join(dir, "mock-source"),
      { recursive: true },
    );
    fs.mkdirSync(path.join(dir, "broken"));
    fs.writeFileSync(
      path.join(dir, "broken/plugin.json"),
      JSON.stringify({
        manifestVersion: 1,
        apiVersion: 99,
        id: "broken",
        name: "Broken",
        version: "1.0.0",
        entry: "index.ts",
      }),
    );
    fs.writeFileSync(
      path.join(dir, "broken/index.ts"),
      "export default { getChapters(){return []}, getPages(){return []}, search(){return {items:[],page:1,hasNextPage:false}} }",
    );

    const scan = await loaderFor(dir).scan({ forceReload: true });
    expect(scan.plugins.map((plugin) => plugin.id)).toEqual(["mock-source"]);
    expect(scan.failures).toHaveLength(1);
    expect(scan.failures[0]?.sourceId).toBe("broken");
  });
});

# Plugins

Put source plugins here, one folder per source:

```
plugins/
  my-source/
    plugin.json
    index.ts
```

Use `pnpm plugin:new my-source` to scaffold from `templates/plugin`, then reload
plugins in Settings. This folder is gitignored except for this README; plugins
are local code and are not distributed with ComicSpace.

Please only connect to APIs/content you have permission to access, and follow
the source's terms and local law. ComicSpace does not ship any sources or
scrapers, and does not provide paywall/DRM bypass functionality.

# Plugin template

1. Copy this folder into `plugins/<id>/` or run `pnpm plugin:new <id>`.
2. Keep `manifest.id` equal to the folder name.
3. Implement `search`/`browse`, `getManga`, `getChapters`, and `getPages` against
   an API you are allowed to use.
4. Put every image CDN host in `allowedImageHosts`.
5. Reload plugins in ComicSpace Settings.
6. Run `pnpm plugin:check` to validate the manifest and entry.

Plugins run as trusted local Node code. Only install plugins you trust.

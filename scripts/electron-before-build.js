// The desktop package has no production dependencies: the server runtime is
// staged into resources/ by scripts/desktop-stage.mjs. Returning false tells
// electron-builder to skip its own install/rebuild step, which would otherwise
// run a workspace-wide `pnpm install --production`.
module.exports = async function beforeBuild() {
  return false;
};

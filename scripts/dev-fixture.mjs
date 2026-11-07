import { spawn } from "node:child_process";

const env = {
  ...process.env,
  COMICSPACE_PLUGINS_DIR: "tests/fixtures/plugins",
  COMICSPACE_IMAGE_ALLOW_HOSTS: "127.0.0.1:8787",
};

const fixture = spawn(process.execPath, ["tests/fixtures/serve.mjs"], {
  stdio: "inherit",
  env,
});

const dev = spawn("pnpm", ["dev"], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  fixture.kill();
  dev.kill();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

dev.on("exit", (code) => {
  fixture.kill();
  process.exit(code ?? 0);
});

fixture.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(`Fixture image server exited with code ${code}`);
    stop();
  }
});

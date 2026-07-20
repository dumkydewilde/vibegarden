import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = "1.33.1-dev57.0";
const files = ["duckdb-browser-eh.worker.js", "duckdb-eh.wasm"];
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(root, "node_modules/@duckdb/duckdb-wasm");
const sourceDirectory = resolve(packageRoot, "dist");
const destinationDirectory = resolve(root, `.renderer-runtime/duckdb/${version}`);

const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
if (packageJson.version !== version) {
  throw new Error(`Expected @duckdb/duckdb-wasm ${version}; found ${packageJson.version ?? "unknown"}.`);
}

await mkdir(destinationDirectory, { recursive: true });
for (const file of files) {
  const source = resolve(sourceDirectory, file);
  await access(source);
  await copyFile(source, resolve(destinationDirectory, file));
}

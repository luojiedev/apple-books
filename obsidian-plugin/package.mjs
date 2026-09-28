import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { zipSync } from "fflate";

const root = fileURLToPath(new URL(".", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (manifest.version !== metadata.version) throw new Error("Plugin versions do not match.");
const output = join(root, "..", "dist", `obsidian-${manifest.version}`);
await mkdir(output, { recursive: true });
const archive = {};
for (const name of ["main.js", "manifest.json", "styles.css"]) {
  const bytes = await readFile(join(root, name));
  archive[`${manifest.id}/${name}`] = bytes;
  await writeFile(join(output, name), bytes);
}
await writeFile(join(output, "versions.json"), await readFile(join(root, "versions.json")));
const archivePath = join(output, `${manifest.id}.zip`);
await writeFile(archivePath, zipSync(archive, { level: 9 }));
console.info(`[Apple Books] Packaged ${archivePath}`);

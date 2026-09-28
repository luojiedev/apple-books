import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const notices = await Promise.all(["sql.js", "fflate", "@xmldom/xmldom"].map(async name => `${name}\n${await readFile(`node_modules/${name}/LICENSE`, "utf8")}`));

await build({
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  external: ["obsidian", "electron"],
  platform: "node",
  format: "cjs",
  target: "es2022",
  banner: { js: `/*! Third-party licenses\n${notices.join("\n\n").replaceAll("*/", "* /")}\n*/` },
  logLevel: "info",
});

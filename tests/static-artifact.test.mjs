import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, readdir } from "node:fs/promises";

test("build emits a GitHub Pages-compatible static artifact", async () => {
  await access(new URL("../dist/index.html", import.meta.url));
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\.\/assets\//);
  assert.doesNotMatch(html, /dist\/server|_next\/|vinext/);
  const files = await readdir(new URL("../dist", import.meta.url));
  assert.ok(files.includes("index.html"));
});

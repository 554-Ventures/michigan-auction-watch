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
  assert.ok(files.includes(".nojekyll"));
});

test("Pages workflow deploys the Vite artifact instead of running Jekyll", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/jekyll-gh-pages.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /actions\/upload-pages-artifact@v3[\s\S]*path: dist/);
  assert.match(workflow, /actions\/deploy-pages@v5/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /git push|contents: write/);
  assert.doesNotMatch(workflow, /jekyll-build-pages/);
});

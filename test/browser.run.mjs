// The browser-lane driver: serves the repo over HTTP, opens the
// harness in headless Chrome via Playwright, and fails when any
// acceptance expectation fails. This is the proof that the package
// runs in a real V8 + real WebAssembly browser environment, not only
// under Node's compat shims.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// The browser imports the BUILT package (browsers cannot run the TS
// sources that vitest transforms); build before serving.
await import("node:child_process").then(({ execSync }) =>
  execSync("npm run build", { cwd: root, stdio: "inherit" }),
);
const types = {
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".html": "text/html",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, "");
    if (path === "" || path.endsWith("/")) path += "index.html";
    if (path === "index.html") path = "test/browser.harness.html";
    const file = join(root, path);
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const { chromium } = await import("playwright");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const failures = [];
  page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => failures.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    if (r.status() >= 400) failures.push(`http ${r.status()}: ${r.url()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction(() => document.title === "moxml-ts-browser-done", null, {
    timeout: 30_000,
  });
  const results = await page.evaluate(() => window.__RESULTS);
  for (const [name, ok, err] of results) {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: ${err}`}`);
    if (!ok) failures.push(`${name}: ${err}`);
  }
  if (results.length === 0) failures.push("no results collected");
  if (failures.length > 0) {
    console.error(`browser lane FAILED:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`browser lane: ${results.length} expectations green (headless Chrome, V8)`);
} finally {
  await browser.close();
  server.close();
}

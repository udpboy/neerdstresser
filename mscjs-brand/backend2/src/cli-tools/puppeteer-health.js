const fs = require("fs");

const withTimeout = (promise, timeoutMs) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs)),
  ]);

module.exports = {
  id: "puppeteer-health",
  name: "Puppeteer Health",
  description: "Checks puppeteer availability and can optionally run a quick launch test.",
  inputs: [{ key: "launchTest", label: "Launch test", type: "checkbox", required: false, default: false }],
  async run(_ctx, input) {
    let puppeteer;
    try {
      puppeteer = require("puppeteer");
    } catch (err) {
      const msg = String(err?.message || err || "Cannot load puppeteer").split("\n")[0] || "Cannot load puppeteer";
      return {
        output: [
          "puppeteer: missing",
          "hint: install on backend with `npm -C backend i puppeteer` (not in sakra-cli)",
          `error: ${msg}`,
        ].join("\n"),
      };
    }

    const out = [];
    out.push("puppeteer: ok");
    if (typeof puppeteer?.version === "function") out.push(`version: ${puppeteer.version()}`);

    let executablePath = "";
    if (typeof puppeteer?.executablePath === "function") {
      try {
        executablePath = String(puppeteer.executablePath() || "");
      } catch {
        executablePath = "";
      }
    }
    if (executablePath) {
      out.push(`executable_path: ${executablePath}`);
      out.push(`executable_exists: ${fs.existsSync(executablePath) ? "yes" : "no"}`);
    }

    const launchTest = !!input?.launchTest;
    if (!launchTest) return { output: out.join("\n") };

    const startedAt = Date.now();
    let browser = null;
    try {
      const launchPromise = puppeteer.launch({
        headless: false,
        args: ["--disable-dev-shm-usage"],
      });

      browser = await withTimeout(launchPromise, 9_000);
      const page = await withTimeout(browser.newPage(), 4_000);
      await withTimeout(page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 4_000 }), 6_000);

      out.push(`launch_test: ok (${Date.now() - startedAt}ms)`);
    } catch (err) {
      out.push(`launch_test: failed (${Date.now() - startedAt}ms)`);
      out.push(`error: ${String(err?.message || err)}`);
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {
          // ignore
        }
      }
    }

    return { output: out.join("\n") };
  },
};

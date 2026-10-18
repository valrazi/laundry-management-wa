/**
 * Uji regresi jaring pengaman proses.
 *
 * Memastikan bahwa promise yang ditolak tanpa penangkap dan exception tak
 * tertangani TIDAK mematikan proses. Ini penting: Baileys pernah melempar
 * `Boom: Connection Closed` dari jalur async internalnya sehingga gateway mati.
 *
 * Uji ini menjalankan proses Node terpisah agar tidak mengganggu proses uji.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawn } from "node:child_process";

const MODULE_URL = new URL("../src/safetyNet.js", import.meta.url).href;

function runChild(body, timeoutMs = 8000) {
  const script = `
    import { installSafetyNet } from ${JSON.stringify(MODULE_URL)};
    installSafetyNet();
    ${body}
  `;

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));

    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

describe("jaring pengaman proses", () => {
  it("tanpa jaring pengaman, proses memang mati (kontrol)", async () => {
    const script = `
      Promise.reject(new Error("boom-kontrol"));
      setTimeout(() => { console.log("MASIH-HIDUP"); process.exit(0); }, 300);
    `;

    const { code, output } = await new Promise((resolve) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (c) => (out += c.toString()));
      child.stderr.on("data", (c) => (out += c.toString()));
      child.on("close", (c) => resolve({ code: c, output: out }));
    });

    assert.notEqual(code, 0, "tanpa penangkap, proses harus keluar dengan error");
    assert.doesNotMatch(output, /MASIH-HIDUP/);
  });

  it("tetap hidup setelah promise ditolak tanpa penangkap", async () => {
    const { code, output } = await runChild(`
      Promise.reject(new Error("boom-rejection"));
      setTimeout(() => { console.log("MASIH-HIDUP"); process.exit(0); }, 300);
    `);

    assert.match(output, /MASIH-HIDUP/);
    assert.equal(code, 0);
    assert.match(output, /boom-rejection/);
  });

  it("tetap hidup saat error dilempar dari callback mutex tanpa penangkap (kasus nyata)", async () => {
    const { code, output } = await runChild(`
      // Meniru retryMutex.mutex(async () => { ... sendRetryRequest ... }) pada
      // Baileys messages-recv.js:661 — promise-nya tidak pernah di-await.
      const mutex = (fn) => Promise.resolve().then(fn);
      mutex(async () => {
        throw new Error("Connection Closed");
      });
      setTimeout(() => { console.log("MASIH-HIDUP"); process.exit(0); }, 400);
    `);

    assert.match(output, /MASIH-HIDUP/);
    assert.equal(code, 0);
    assert.match(output, /Connection Closed/);
  });

  it("tetap hidup setelah exception tak tertangani", async () => {
    const { code, output } = await runChild(`
      setTimeout(() => { throw new Error("boom-exception"); }, 50);
      setTimeout(() => { console.log("MASIH-HIDUP"); process.exit(0); }, 400);
    `);

    assert.match(output, /MASIH-HIDUP/);
    assert.equal(code, 0);
    assert.match(output, /boom-exception/);
  });
});

/**
 * Uji halaman status, khususnya pengamanan QR saat diakses dari luar
 * (misalnya lewat ngrok).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderStatusPage } from "../src/statusPage.js";

const QR_DATA_URL = "data:image/png;base64,ABCD";
const AUTO_REPLY = { enabled: true, date: "2026-10-18", count: 0 };

function status(overrides = {}) {
  return {
    connected: false,
    connecting: false,
    mock: false,
    user: null,
    hasQr: true,
    qr: QR_DATA_URL,
    lastError: null,
    lastConnectedAt: null,
    reconnectAttempts: 0,
    uptimeSeconds: 5,
    ...overrides,
  };
}

describe("halaman status", () => {
  it("menampilkan QR untuk akses dari komputer sendiri", () => {
    const html = renderStatusPage(status(), AUTO_REPLY, { allowQr: true });
    assert.match(html, /QR WhatsApp/);
    assert.ok(html.includes(QR_DATA_URL));
  });

  it("menyembunyikan QR untuk akses dari luar", () => {
    const html = renderStatusPage(status(), AUTO_REPLY, { allowQr: false });
    assert.match(html, /QR disembunyikan/);
    assert.ok(!html.includes(QR_DATA_URL), "data QR tidak boleh ikut terkirim");
  });

  it("menampilkan pesan tertaut bila perangkat sudah terhubung", () => {
    const html = renderStatusPage(
      status({ connected: true, qr: null }),
      AUTO_REPLY,
    );
    assert.match(html, /Perangkat sudah tertaut/);
  });

  it("memberi tahu bila QR belum siap", () => {
    const html = renderStatusPage(status({ qr: null }), AUTO_REPLY);
    assert.match(html, /QR belum siap/);
  });
});

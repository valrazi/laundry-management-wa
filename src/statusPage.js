/**
 * Halaman status sederhana (HTML) untuk memantau koneksi dan melihat QR.
 * Halaman ini TIDAK menampilkan API key.
 */
import { config } from "./config.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderStatusPage(status, autoReply = {}) {
  const badge = status.connected
    ? '<span class="badge ok">Terhubung</span>'
    : '<span class="badge off">Belum terhubung</span>';

  const qrBlock = status.qr
    ? `<div class="qr">
         <img src="${escapeHtml(status.qr)}" alt="QR WhatsApp" width="320" height="320" />
         <p>Buka <strong>WhatsApp &rarr; Perangkat Tertaut &rarr; Tautkan perangkat</strong>, lalu scan QR di atas.</p>
       </div>`
    : status.connected
      ? '<p class="muted">Perangkat sudah tertaut. QR tidak diperlukan.</p>'
      : '<p class="muted">QR belum siap. Halaman ini menyegarkan diri secara otomatis.</p>';

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="5" />
<title>WhatsApp Gateway</title>
<style>
  :root { --navy:#1E3A5F; --blue:#61A5F8; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; background:#f5f7fa; color:#1f2937; }
  header { background:var(--navy); color:#fff; padding:16px 24px; }
  header h1 { margin:0; font-size:18px; font-weight:600; }
  main { max-width:640px; margin:24px auto; padding:0 16px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:20px; }
  .badge { display:inline-block; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:600; }
  .badge.ok { background:#dcfce7; color:#166534; }
  .badge.off { background:#fee2e2; color:#991b1b; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:8px 16px; margin:16px 0 0; font-size:14px; }
  dt { color:#6b7280; }
  dd { margin:0; word-break:break-word; }
  .qr { text-align:center; margin-top:20px; }
  .qr img { border:1px solid #e5e7eb; border-radius:8px; background:#fff; }
  .qr p { font-size:13px; color:#374151; margin-top:12px; }
  .muted { color:#6b7280; font-size:14px; }
  footer { text-align:center; color:#9ca3af; font-size:12px; margin:16px 0 32px; }
</style>
</head>
<body>
<header><h1>WhatsApp Gateway &mdash; Status</h1></header>
<main>
  <div class="card">
    ${badge}
    <dl>
      <dt>Mode</dt><dd>${status.mock ? "Simulasi (MOCK_MODE)" : "Nyata"}</dd>
      <dt>Balasan otomatis</dt><dd>${autoReply.enabled ? `Aktif &mdash; ${autoReply.count ?? 0} nomor dibalas hari ini (${escapeHtml(autoReply.date || "-")})` : "Nonaktif"}</dd>
      <dt>Nomor tertaut</dt><dd>${escapeHtml(status.user?.id || "-")}</dd>
      <dt>Uptime</dt><dd>${status.uptimeSeconds} detik</dd>
      <dt>Percobaan sambung ulang</dt><dd>${status.reconnectAttempts}</dd>
      <dt>Error terakhir</dt><dd>${escapeHtml(status.lastError || "-")}</dd>
      <dt>Endpoint kirim</dt><dd>POST http://${escapeHtml(config.host)}:${config.port}/send</dd>
    </dl>
    ${qrBlock}
  </div>
  <footer>Halaman ini hanya menampilkan status koneksi. API key tidak pernah ditampilkan.</footer>
</main>
</body>
</html>`;
}

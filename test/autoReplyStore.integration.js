/**
 * Uji integrasi penyimpanan MySQL (tabel `auto_reply_logs`).
 * Memerlukan DATABASE_URL yang valid di .env.
 *
 * Berkas ini SENGAJA tidak diberi nama `*.test.js` supaya tidak ikut berjalan
 * saat `npm test` (agar pengujian rutin tidak menyentuh database).
 *
 * Jalankan manual: node test/autoReplyStore.integration.js
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createMysqlStore } from "../src/autoReplyStore.js";
import { closePool, getPool } from "../src/db.js";

// Nilai sentinel agar tidak mengganggu data balasan yang sesungguhnya.
const DAY = "1900-01-01";
const SENDER = "000000000000";
const ENTRY = {
  senderKey: SENDER,
  senderJid: `${SENDER}@s.whatsapp.net`,
  pushName: "Uji Integrasi",
  dayKey: DAY,
  messageSnapshot: "pesan uji integrasi",
};

const pool = getPool();
const store = createMysqlStore(pool);

async function cleanup() {
  await pool.execute("DELETE FROM `auto_reply_logs` WHERE `dayKey` = ?", [DAY]);
}

after(async () => {
  await cleanup();
  await closePool();
});

describe("penyimpanan MySQL auto-reply", () => {
  it("mengklaim hanya sekali untuk (senderKey, dayKey) yang sama", async () => {
    await cleanup();

    const first = await store.claim(ENTRY);
    assert.equal(first.claimed, true);

    const second = await store.claim(ENTRY);
    assert.equal(second.claimed, false, "unique index harus menolak klaim kedua");
  });

  it("mencatat providerMessageId dan menghitung per hari", async () => {
    await cleanup();

    const claim = await store.claim(ENTRY);
    await store.confirm(claim.id, "MSG-INTEGRASI");

    const rows = await store.listByDay(DAY, 10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].providerMessageId, "MSG-INTEGRASI");
    assert.equal(rows[0].senderKey, SENDER);
    assert.equal(rows[0].pushName, "Uji Integrasi");
    assert.equal(await store.countByDay(DAY), 1);
  });

  it("melepas klaim sehingga bisa diklaim ulang", async () => {
    await cleanup();

    const claim = await store.claim(ENTRY);
    await store.release(claim.id);
    assert.equal(await store.countByDay(DAY), 0);

    const again = await store.claim(ENTRY);
    assert.equal(again.claimed, true);
  });

  it("menyimpan createdAt sebagai waktu UTC yang benar", async () => {
    await cleanup();

    await store.claim(ENTRY);
    const [row] = await store.listByDay(DAY, 10);

    assert.ok(row.createdAt instanceof Date, "createdAt harus berupa Date");
    // Bila zona waktu salah, selisihnya akan mencapai beberapa jam.
    const diffMs = Math.abs(row.createdAt.getTime() - Date.now());
    assert.ok(diffMs < 60_000, `selisih waktu terlalu besar: ${diffMs} ms`);
  });

  it("menolak jumlah hari yang tidak dikenal sebagai hari kosong", async () => {
    await cleanup();
    assert.equal(await store.countByDay("1900-02-02"), 0);
    assert.deepEqual(await store.listByDay("1900-02-02", 10), []);
  });
});

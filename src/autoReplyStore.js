/**
 * Penyimpanan riwayat balasan otomatis.
 *
 * Dua implementasi:
 * - `createMemoryStore()`  : hanya untuk pengujian, tidak butuh MySQL.
 * - `createMysqlStore()`   : dipakai runtime, menulis ke tabel `auto_reply_logs`.
 *
 * Kontrak store (dipakai `autoReply.js`):
 *   claim(entry)                  -> { claimed: boolean, id?: string }
 *   confirm(id, providerMessageId)-> void
 *   release(id)                   -> void
 *   countByDay(dayKey)            -> number
 *   listByDay(dayKey, limit)      -> Array
 */
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { getPool } from "./db.js";

const TABLE = "auto_reply_logs";

// ---------------------------------------------------------------------------
// Implementasi di memori (pengujian)
// ---------------------------------------------------------------------------

export function createMemoryStore() {
  const rows = new Map();
  const keyOf = (senderKey, dayKey) => `${dayKey}\u0000${senderKey}`;

  return {
    kind: "memory",

    async claim(entry) {
      const key = keyOf(entry.senderKey, entry.dayKey);
      if (rows.has(key)) return { claimed: false };
      const id = randomUUID();
      rows.set(key, {
        id,
        senderKey: entry.senderKey,
        senderJid: entry.senderJid,
        pushName: entry.pushName ?? null,
        dayKey: entry.dayKey,
        messageSnapshot: entry.messageSnapshot,
        providerMessageId: null,
        createdAt: new Date(),
      });
      return { claimed: true, id };
    },

    async confirm(id, providerMessageId) {
      for (const row of rows.values()) {
        if (row.id === id) row.providerMessageId = providerMessageId ?? null;
      }
    },

    async release(id) {
      for (const [key, row] of rows.entries()) {
        if (row.id === id) rows.delete(key);
      }
    },

    async countByDay(dayKey) {
      return [...rows.values()].filter((row) => row.dayKey === dayKey).length;
    },

    async listByDay(dayKey, limit = 20) {
      return [...rows.values()]
        .filter((row) => row.dayKey === dayKey)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    },
  };
}

// ---------------------------------------------------------------------------
// Implementasi MySQL (runtime)
// ---------------------------------------------------------------------------

export function createMysqlStore(pool) {
  return {
    kind: "mysql",

    /**
     * Mengklaim hak membalas hari ini. INSERT yang bentrok dengan unique index
     * (senderKey, dayKey) menandakan nomor ini sudah dibalas hari ini.
     */
    async claim(entry) {
      const id = randomUUID();
      try {
        await pool.execute(
          `INSERT INTO \`${TABLE}\`
             (\`id\`, \`senderKey\`, \`senderJid\`, \`pushName\`, \`dayKey\`, \`messageSnapshot\`, \`createdAt\`)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            entry.senderKey,
            entry.senderJid,
            entry.pushName ?? null,
            entry.dayKey,
            entry.messageSnapshot,
            new Date(),
          ],
        );
        return { claimed: true, id };
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY") return { claimed: false };
        throw error;
      }
    },

    async confirm(id, providerMessageId) {
      await pool.execute(
        `UPDATE \`${TABLE}\` SET \`providerMessageId\` = ? WHERE \`id\` = ?`,
        [providerMessageId ?? null, id],
      );
    },

    async release(id) {
      await pool.execute(`DELETE FROM \`${TABLE}\` WHERE \`id\` = ?`, [id]);
    },

    async countByDay(dayKey) {
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total FROM \`${TABLE}\` WHERE \`dayKey\` = ?`,
        [dayKey],
      );
      return Number(rows?.[0]?.total ?? 0);
    },

    async listByDay(dayKey, limit = 20) {
      const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
      const [rows] = await pool.execute(
        `SELECT \`id\`, \`senderKey\`, \`senderJid\`, \`pushName\`, \`dayKey\`,
                \`providerMessageId\`, \`createdAt\`
           FROM \`${TABLE}\`
          WHERE \`dayKey\` = ?
          ORDER BY \`createdAt\` DESC
          LIMIT ${safeLimit}`,
        [dayKey],
      );
      return rows;
    },
  };
}

// ---------------------------------------------------------------------------
// Store aktif saat runtime
// ---------------------------------------------------------------------------

let activeStore = null;

/** Mengembalikan store runtime, atau null bila DATABASE_URL belum diatur. */
export function getAutoReplyStore() {
  if (!config.databaseUrl) return null;
  if (!activeStore) activeStore = createMysqlStore(getPool());
  return activeStore;
}

/** Menyuntikkan store lain (dipakai pengujian). */
export function setAutoReplyStore(store) {
  activeStore = store;
}

/**
 * Memastikan tabel sudah ada. Memberi pesan yang jelas bila migrasi belum
 * dijalankan di aplikasi laundry.
 */
export async function verifyAutoReplyTable() {
  const store = getAutoReplyStore();
  if (!store) {
    return {
      ok: false,
      store: null,
      message: "DATABASE_URL belum diatur di .env gateway.",
    };
  }
  try {
    await getPool().query(`SELECT 1 FROM \`${TABLE}\` LIMIT 1`);
    return { ok: true, store: store.kind };
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") {
      return {
        ok: false,
        store: store.kind,
        message:
          `Tabel "${TABLE}" belum ada. Jalankan migrasi Prisma di aplikasi laundry: npx prisma migrate deploy`,
      };
    }
    return {
      ok: false,
      store: store.kind,
      message: error?.message || "Gagal memeriksa tabel auto_reply_logs.",
    };
  }
}

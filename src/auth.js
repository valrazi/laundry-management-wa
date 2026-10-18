/**
 * Autentikasi request masuk memakai API key.
 */
import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Middleware yang memvalidasi API key dari header:
 *   - `Authorization: <API_KEY>`  (kompatibel dengan adapter Fonnte di aplikasi laundry)
 *   - `Authorization: Bearer <API_KEY>`
 *   - `x-api-key: <API_KEY>`
 */
export function requireApiKey(req, res, next) {
  const raw = (req.get("authorization") || "").trim();
  const withoutBearer = /^bearer\s+/i.test(raw)
    ? raw.replace(/^bearer\s+/i, "").trim()
    : raw;
  const provided = withoutBearer || (req.get("x-api-key") || "").trim();

  if (!provided || !safeEqual(provided, config.apiKey)) {
    return res
      .status(401)
      .json({ status: false, reason: "API key tidak valid." });
  }
  return next();
}

const express = require("express");
const { db, get } = require("../db");

const router = express.Router();

router.get("/stats/users", async (_req, res) => {
  try {
    const totalRow = await get("SELECT COUNT(*) AS total FROM users", []);
    const windowMs = 5 * 60 * 1000;
    const threshold = Date.now() - windowMs;
    const onlineRow = await get(
      "SELECT COUNT(*) AS online FROM users WHERE session_token IS NOT NULL AND session_last_seen >= ?",
      [threshold],
    );
    return res.json({
      total: totalRow?.total ? Number(totalRow.total) : 0,
      online: onlineRow?.online ? Number(onlineRow.online) : 0,
    });
  } catch (err) {
    console.error("Stats users error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/stats/method-usage", async (_req, res) => {
  try {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const windowStart = todayStart - 6 * dayMs;
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT l.method_id, l.start_at, m.display_name, m.name
         FROM attack_logs l
         JOIN methods m ON m.id = l.method_id
         WHERE l.start_at >= ?
        `,
        [windowStart],
        (err, data) => (err ? reject(err) : resolve(data || [])),
      );
    });

    const labels = Array.from({ length: 7 }, (_, idx) => {
      const d = new Date(windowStart + idx * dayMs);
      return d.toISOString().slice(0, 10);
    });

    const map = new Map();
    for (const r of rows) {
      const idx = Math.floor((r.start_at - windowStart) / dayMs);
      if (idx < 0 || idx >= 7) continue;
      if (!map.has(r.method_id)) {
        map.set(r.method_id, {
          id: r.method_id,
          name: r.name,
          displayName: r.display_name,
          series: Array(7).fill(0),
        });
      }
      const entry = map.get(r.method_id);
      entry.series[idx] += 1;
    }

    const methods = Array.from(map.values()).map((m) => ({
      ...m,
      total: m.series.reduce((a, b) => a + b, 0),
    }));

    return res.json({ labels, methods });
  } catch (err) {
    console.error("Method usage stats error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

module.exports = router;

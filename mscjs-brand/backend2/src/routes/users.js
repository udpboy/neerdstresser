const express = require("express");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { run, get, db, withTransaction, ensureUserUniqueCode } = require("../db");
const { logBalanceActivity } = require("../lib/balance");

const router = express.Router();

router.get("/admin/users", authenticate, requireAdmin, async (_req, res) => {
  try {
    await ensureUserUniqueCode();
    const rows = await new Promise((resolve, reject) => {
      db.all(
        "SELECT id, username, created_at, telegram_id, is_admin, is_banned, balance, unique_code FROM users ORDER BY id ASC",
        [],
        (err, data) => (err ? reject(err) : resolve(data)),
      );
    });
    res.json({
      users: rows.map((u) => ({
        id: u.id,
        username: u.username,
        createdAt: u.created_at,
        telegramId: u.telegram_id,
        isAdmin: Boolean(u.is_admin),
        isBanned: Boolean(u.is_banned),
        balance: u.balance ?? 0,
        uniqueCode: u.unique_code,
      })),
    });
  } catch (err) {
    console.error("Admin list users error", err);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.patch("/admin/users/:id", authenticate, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ message: "User ID tidak valid" });
  }
  const { isAdmin, isBanned, telegramId, username } = req.body || {};
  try {
    const target = await get(
      "SELECT id, username, telegram_id, is_admin, is_banned FROM users WHERE id = ?",
      [userId],
    );
    if (!target) return res.status(404).json({ message: "User tidak ditemukan" });

    let nextUsername = target.username;
    if (typeof username === "string") {
      const trimmed = username.trim();
      if (trimmed.length < 3 || trimmed.length > 32) {
        return res.status(400).json({ message: "Username 3-32 karakter" });
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
        return res.status(400).json({ message: "Username hanya huruf, angka, titik, strip, atau underscore" });
      }
      if (trimmed !== target.username) {
        const conflict = await get("SELECT id FROM users WHERE username = ?", [trimmed]);
        if (conflict && conflict.id !== userId) {
          return res.status(409).json({ message: "Username sudah dipakai" });
        }
        nextUsername = trimmed;
      }
    }

    const nextAdmin = typeof isAdmin === "boolean" ? (isAdmin ? 1 : 0) : target.is_admin;
    const nextBanned = typeof isBanned === "boolean" ? (isBanned ? 1 : 0) : target.is_banned;
    const nextTelegram = telegramId === undefined
      ? target.telegram_id
      : (telegramId && /^[0-9]{3,32}$/.test(String(telegramId).trim()))
        ? String(telegramId).trim()
        : telegramId === "" || telegramId === null
          ? null
          : (() => {
              res.status(400).json({ message: "Telegram ID harus angka 3-32 digit atau kosong" });
              return undefined;
            })();
    if (nextTelegram === undefined) return;

    await run(
      "UPDATE users SET username = ?, is_admin = ?, is_banned = ?, telegram_id = ? WHERE id = ?",
      [nextUsername, nextAdmin, nextBanned, nextTelegram, userId],
    );
    return res.json({
      message: "User diperbarui",
      user: {
        id: target.id,
        username: nextUsername,
        telegramId: nextTelegram,
        isAdmin: Boolean(nextAdmin),
        isBanned: Boolean(nextBanned),
      },
    });
  } catch (err) {
    console.error("Admin update user error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.delete("/admin/users/:id", authenticate, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ message: "User ID tidak valid" });
  }
  if (userId === req.user.id) {
    return res.status(400).json({ message: "Tidak dapat menghapus akun sendiri" });
  }
  try {
    const target = await get("SELECT id FROM users WHERE id = ?", [userId]);
    if (!target) return res.status(404).json({ message: "User tidak ditemukan" });
    await run("DELETE FROM users WHERE id = ?", [userId]);
    return res.json({ message: "User dihapus" });
  } catch (err) {
    console.error("Admin delete user error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.post("/admin/users/:id/balance", authenticate, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const { amount, requestId } = req.body || {};
  if (!Number.isInteger(userId)) return res.status(400).json({ message: "User ID tidak valid" });
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0 || amt > 1_000_000_000) {
    return res.status(400).json({ message: "Amount harus angka positif dan wajar" });
  }
  const reqId = typeof requestId === "string" && requestId.trim().length >= 8 ? requestId.trim() : null;
  if (!reqId) return res.status(400).json({ message: "requestId wajib diisi untuk mencegah duplikasi" });

  try {
    const result = await withTransaction(async () => {
      const target = await get("SELECT id, balance FROM users WHERE id = ?", [userId]);
      if (!target) throw new Error("USER_NOT_FOUND");

      const dup = await get("SELECT id FROM balance_topups WHERE id = ?", [reqId]);
      if (dup) throw new Error("DUPLICATE");

      const now = new Date().toISOString();
      await run(
        "INSERT INTO balance_topups (id, user_id, admin_id, amount, created_at) VALUES (?, ?, ?, ?, ?)",
        [reqId, userId, req.user.id, amt, now],
      );
      await run("UPDATE users SET balance = balance + ? WHERE id = ?", [amt, userId]);
      await logBalanceActivity(userId, "topup", amt, `topup:${reqId}`, req.user.id);
      const updated = await get("SELECT balance FROM users WHERE id = ?", [userId]);
      return updated?.balance ?? target.balance + amt;
    });

    return res.json({ message: "Balance ditambahkan", balance: result });
  } catch (err) {
    if (err.message === "USER_NOT_FOUND") return res.status(404).json({ message: "User tidak ditemukan" });
    if (err.message === "DUPLICATE") return res.status(409).json({ message: "Request sudah diproses" });
    console.error("Admin add balance error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.get("/admin/balance-logs", authenticate, requireAdmin, async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const search = (req.query.user || "").toString().trim();
  const pageSize = 10;

  try {
    const params = [];
    const where = search ? "WHERE u.username LIKE ?" : "";
    if (search) params.push(`%${search}%`);

    const countRow = await get(
      `SELECT COUNT(*) AS total FROM balance_logs bl JOIN users u ON bl.user_id = u.id ${where}`,
      params,
    );
    const total = countRow?.total ? Number(countRow.total) : 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;

    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT bl.id, bl.type, bl.amount, bl.note, bl.created_at, bl.user_id, u.username AS user_username,
                bl.admin_id, a.username AS admin_username
         FROM balance_logs bl
         JOIN users u ON bl.user_id = u.id
         LEFT JOIN users a ON bl.admin_id = a.id
         ${where}
         ORDER BY bl.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset],
        (err, data) => (err ? reject(err) : resolve(data || [])),
      );
    });

    return res.json({
      logs: rows.map((r) => ({
        id: r.id,
        type: r.type,
        amount: r.amount,
        note: r.note,
        createdAt: r.created_at,
        user: { id: r.user_id, username: r.user_username },
        admin: r.admin_id ? { id: r.admin_id, username: r.admin_username || "admin" } : null,
      })),
      page,
      pageSize,
      total,
      totalPages,
    });
  } catch (err) {
    console.error("Balance logs error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.post("/admin/users/:id/plan", authenticate, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const { planId } = req.body || {};
  if (!Number.isInteger(userId)) return res.status(400).json({ message: "User ID tidak valid" });
  const planNum = Number(planId);
  if (!Number.isInteger(planNum)) return res.status(400).json({ message: "Plan tidak valid" });

  try {
    const result = await withTransaction(async () => {
      const user = await get("SELECT id FROM users WHERE id = ?", [userId]);
      if (!user) throw new Error("USER_NOT_FOUND");

      const plan = await get(
        "SELECT id, name, duration_days, stock FROM plans WHERE id = ?",
        [planNum],
      );
      if (!plan) throw new Error("PLAN_NOT_FOUND");
      if (plan.stock <= 0) throw new Error("OUT_OF_STOCK");

      const stockRes = await run("UPDATE plans SET stock = stock - 1 WHERE id = ? AND stock > 0", [plan.id]);
      if (stockRes.changes === 0) throw new Error("OUT_OF_STOCK");

      const expiresAt = plan.duration_days ? Date.now() + plan.duration_days * 24 * 60 * 60 * 1000 : null;
      await run(
        "INSERT OR REPLACE INTO user_plans (user_id, plan_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        [userId, plan.id, expiresAt, new Date().toISOString()],
      );

      return { planId: plan.id, expiresAt };
    });

    return res.json({
      message: "Plan ditambahkan ke user",
      plan: { id: result.planId, expiresAt: result.expiresAt },
    });
  } catch (err) {
    if (err.message === "USER_NOT_FOUND") return res.status(404).json({ message: "User tidak ditemukan" });
    if (err.message === "PLAN_NOT_FOUND") return res.status(404).json({ message: "Plan tidak ditemukan" });
    if (err.message === "OUT_OF_STOCK") return res.status(400).json({ message: "Stok habis" });
    console.error("Admin add user plan error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

module.exports = router;

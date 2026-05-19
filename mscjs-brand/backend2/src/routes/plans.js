const express = require("express");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { get, run, withTransaction } = require("../db");
const { logBalanceActivity } = require("../lib/balance");
const { getActiveUserPlan } = require("../lib/plan");

const router = express.Router();

router.get("/plans", async (_req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      require("../db").db.all(
        "SELECT id, name, display_html, max_concurrent, max_time, price, discount, stock, api_access, premium_access, duration_days, is_private, created_at FROM plans WHERE is_private = 0 ORDER BY id ASC",
        [],
        (err, data) => (err ? reject(err) : resolve(data || [])),
      );
    });
    const plans = rows.map((p) => ({
      ...p,
      final_price: Math.max(0, p.price - Math.floor((p.price * (p.discount || 0)) / 100)),
      api_access: Boolean(p.api_access),
      premium_access: Boolean(p.premium_access),
      is_private: Boolean(p.is_private),
    }));
    return res.json({ plans });
  } catch (err) {
    console.error("List plans error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.get("/balance", authenticate, async (req, res) => {
  try {
    const row = await get("SELECT balance FROM users WHERE id = ?", [req.user.id]);
    return res.json({ balance: row?.balance ?? 0 });
  } catch (err) {
    console.error("Balance error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.get("/plan/me", authenticate, async (req, res) => {
  try {
    const plan = await getActiveUserPlan(req.user.id);
    if (!plan) return res.json({ plan: null });
    const { id: _omit, ...rest } = plan;
    return res.json({ plan: rest });
  } catch (err) {
    console.error("User plan error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.get("/admin/plans", authenticate, requireAdmin, async (_req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      require("../db").db.all(
        "SELECT id, name, display_html, max_concurrent, max_time, price, discount, stock, api_access, premium_access, duration_days, is_private, created_at FROM plans ORDER BY id ASC",
        [],
        (err, data) => (err ? reject(err) : resolve(data || [])),
      );
    });
    const plans = rows.map((p) => ({
      ...p,
      final_price: Math.max(0, p.price - Math.floor((p.price * (p.discount || 0)) / 100)),
      api_access: Boolean(p.api_access),
      premium_access: Boolean(p.premium_access),
      is_private: Boolean(p.is_private),
    }));
    return res.json({ plans });
  } catch (err) {
    console.error("Admin list plans error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.post("/admin/plans", authenticate, requireAdmin, async (req, res) => {
  const {
    name,
    displayHtml,
    maxConcurrent,
    maxTime,
    price,
    discount = 0,
    stock = 0,
    apiAccess = false,
    premiumAccess = false,
    durationDays = null,
    isPrivate = false,
  } = req.body || {};
  if (!name || !displayHtml) return res.status(400).json({ message: "Nama dan display wajib diisi" });
  const maxC = Number(maxConcurrent);
  const maxT = Number(maxTime);
  const priceNum = Number(price);
  const disc = Number(discount || 0);
  const stockNum = Number(stock || 0);
  const durationNum = durationDays === null ? null : Number(durationDays);
  if (!Number.isInteger(maxC) || maxC < 1) return res.status(400).json({ message: "Max concurrent minimal 1" });
  if (!Number.isInteger(maxT) || maxT < 1) return res.status(400).json({ message: "Max time minimal 1" });
  if (!Number.isInteger(priceNum) || priceNum < 0) return res.status(400).json({ message: "Price tidak valid" });
  if (!Number.isInteger(disc) || disc < 0 || disc > 100) return res.status(400).json({ message: "Diskon 0-100" });
  if (!Number.isInteger(stockNum) || stockNum < 0) return res.status(400).json({ message: "Stock tidak valid" });
  if (durationNum !== null && (!Number.isInteger(durationNum) || durationNum < 1)) {
    return res.status(400).json({ message: "Durasi hari tidak valid" });
  }
  const privateFlag = Boolean(isPrivate);
  try {
    const now = new Date().toISOString();
    const result = await run(
      "INSERT INTO plans (name, display_html, max_concurrent, max_time, price, discount, stock, api_access, premium_access, duration_days, is_private, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        String(name).trim(),
        String(displayHtml).trim(),
        maxC,
        maxT,
        priceNum,
        disc,
        stockNum,
        apiAccess ? 1 : 0,
        premiumAccess ? 1 : 0,
        durationNum,
        privateFlag ? 1 : 0,
        now,
      ],
    );
    const plan = {
      id: result.lastID,
      name: String(name).trim(),
      display_html: String(displayHtml).trim(),
      max_concurrent: maxC,
      max_time: maxT,
      price: priceNum,
      discount: disc,
      stock: stockNum,
      api_access: !!apiAccess,
      premium_access: !!premiumAccess,
      duration_days: durationNum,
      is_private: privateFlag,
      created_at: now,
      final_price: Math.max(0, priceNum - Math.floor((priceNum * disc) / 100)),
    };
    return res.status(201).json({ message: "Plan ditambahkan", plan });
  } catch (err) {
    console.error("Create plan error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.patch("/admin/plans/:id", authenticate, requireAdmin, async (req, res) => {
  const planId = Number(req.params.id);
  if (!Number.isInteger(planId)) return res.status(400).json({ message: "ID tidak valid" });
  const {
    name,
    displayHtml,
    maxConcurrent,
    maxTime,
    price,
    discount,
    stock,
    apiAccess,
    premiumAccess,
    durationDays,
    isPrivate,
  } = req.body || {};
  const fields = {
    name: name !== undefined ? String(name).trim() : null,
    display_html: displayHtml !== undefined ? String(displayHtml).trim() : null,
    max_concurrent: maxConcurrent !== undefined ? Number(maxConcurrent) : null,
    max_time: maxTime !== undefined ? Number(maxTime) : null,
    price: price !== undefined ? Number(price) : null,
    discount: discount !== undefined ? Number(discount) : null,
    stock: stock !== undefined ? Number(stock) : null,
    api_access: apiAccess === undefined ? null : apiAccess ? 1 : 0,
    premium_access: premiumAccess === undefined ? null : premiumAccess ? 1 : 0,
    duration_days: durationDays === undefined ? null : durationDays === null ? null : Number(durationDays),
    is_private: isPrivate === undefined ? null : isPrivate ? 1 : 0,
  };
  if (fields.discount !== null && (fields.discount < 0 || fields.discount > 100)) {
    return res.status(400).json({ message: "Diskon 0-100" });
  }
  try {
    const existing = await get("SELECT id FROM plans WHERE id = ?", [planId]);
    if (!existing) return res.status(404).json({ message: "Plan tidak ditemukan" });
    await run(
      "UPDATE plans SET name = COALESCE(?, name), display_html = COALESCE(?, display_html), max_concurrent = COALESCE(?, max_concurrent), max_time = COALESCE(?, max_time), price = COALESCE(?, price), discount = COALESCE(?, discount), stock = COALESCE(?, stock), api_access = COALESCE(?, api_access), premium_access = COALESCE(?, premium_access), duration_days = COALESCE(?, duration_days), is_private = COALESCE(?, is_private) WHERE id = ?",
      [
        fields.name,
        fields.display_html,
        fields.max_concurrent,
        fields.max_time,
        fields.price,
        fields.discount,
        fields.stock,
        fields.api_access,
        fields.premium_access,
        fields.duration_days,
        fields.is_private,
        planId,
      ],
    );
    const updated = await get(
      "SELECT id, name, display_html, max_concurrent, max_time, price, discount, stock, api_access, premium_access, duration_days, is_private, created_at FROM plans WHERE id = ?",
      [planId],
    );
    updated.api_access = !!updated.api_access;
    updated.premium_access = !!updated.premium_access;
    updated.is_private = !!updated.is_private;
    updated.final_price = Math.max(0, updated.price - Math.floor((updated.price * (updated.discount || 0)) / 100));
    return res.json({ message: "Plan diperbarui", plan: updated });
  } catch (err) {
    console.error("Update plan error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.delete("/admin/plans/:id", authenticate, requireAdmin, async (req, res) => {
  const planId = Number(req.params.id);
  if (!Number.isInteger(planId)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    const existing = await get("SELECT id FROM plans WHERE id = ?", [planId]);
    if (!existing) return res.status(404).json({ message: "Plan tidak ditemukan" });
    await run("DELETE FROM user_plans WHERE plan_id = ?", [planId]); // hindari FK blockage
    await run("DELETE FROM plans WHERE id = ?", [planId]);
    return res.json({ message: "Plan dihapus" });
  } catch (err) {
    console.error("Delete plan error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.post("/plans/buy", authenticate, async (req, res) => {
  const { planId } = req.body || {};
  const planNum = Number(planId);
  if (!Number.isInteger(planNum)) return res.status(400).json({ message: "Plan tidak valid" });
  try {
    const active = await getActiveUserPlan(req.user.id);
    if (active && active.id === planNum) {
      return res.status(400).json({ message: "Plan ini sudah aktif. Silakan upgrade ke plan lain." });
    }

    const result = await withTransaction(async () => {
      const plan = await get("SELECT id, price, discount, stock, duration_days, is_private FROM plans WHERE id = ?", [planNum]);
      if (!plan) throw new Error("PLAN_NOT_FOUND");
      if (plan.is_private) throw new Error("PLAN_PRIVATE");
      if (plan.stock <= 0) throw new Error("OUT_OF_STOCK");
      const finalPrice = Math.max(0, plan.price - Math.floor((plan.price * (plan.discount || 0)) / 100));

      const user = await get("SELECT id, balance FROM users WHERE id = ?", [req.user.id]);
      if (!user) throw new Error("USER_NOT_FOUND");
      if (user.balance < finalPrice) throw new Error("INSUFFICIENT");

      const expiresAt = plan.duration_days ? Date.now() + plan.duration_days * 24 * 60 * 60 * 1000 : null;
      const stockRes = await run("UPDATE plans SET stock = stock - 1 WHERE id = ? AND stock > 0", [plan.id]);
      if (stockRes.changes === 0) throw new Error("OUT_OF_STOCK");
      await run("UPDATE users SET balance = balance - ? WHERE id = ?", [finalPrice, req.user.id]);
      await run(
        "INSERT OR REPLACE INTO user_plans (user_id, plan_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        [req.user.id, plan.id, expiresAt, new Date().toISOString()],
      );
      await logBalanceActivity(req.user.id, "spend", finalPrice, `buy-plan:${plan.id}`, null);
      const newBalanceRow = await get("SELECT balance FROM users WHERE id = ?", [req.user.id]);
      return { balance: newBalanceRow?.balance ?? 0 };
    });

    return res.json({
      message: "Plan dibeli",
      balance: result.balance,
    });
  } catch (err) {
    console.error("Buy plan error", err);
    if (err.message === "PLAN_NOT_FOUND") return res.status(404).json({ message: "Plan tidak ditemukan" });
    if (err.message === "PLAN_PRIVATE") return res.status(404).json({ message: "Plan tidak tersedia" });
    if (err.message === "OUT_OF_STOCK") return res.status(400).json({ message: "Stok habis" });
    if (err.message === "INSUFFICIENT") return res.status(400).json({ message: "Saldo tidak cukup" });
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

module.exports = router;

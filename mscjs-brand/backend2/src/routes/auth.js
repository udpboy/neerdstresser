const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { authenticate, issueToken, setAuthCookie, clearAuthCookie, parseCookies } = require("../middleware/auth");
const { generateCaptcha, validateCaptcha } = require("../lib/captcha");
const { run, get, ensureUserUniqueCode } = require("../db");
const { getActiveUserPlan } = require("../lib/plan");
const { JWT_SECRET, SESSION_COOKIE_NAME } = require("../config");

const sanitizeUser = (user) => ({
  username: user.username,
  telegramId: user.telegram_id ?? user.telegramId ?? null,
  isAdmin: Boolean(user.is_admin ?? user.isAdmin),
  isBanned: Boolean(user.is_banned ?? user.isBanned ?? 0),
  balance: user.balance ?? 0,
  uniqueCode: user.unique_code ?? user.uniqueCode ?? null,
});

const planSummary = (plan) =>
  plan
    ? {
        name: plan.name,
        maxConcurrent: plan.maxConcurrent,
        maxTime: plan.maxTime,
        premiumAccess: !!plan.premiumAccess,
        apiAccess: !!plan.apiAccess,
        expiresAt: plan.expiresAt || null,
      }
    : null;

const extractToken = (req) => {
  const headerAuth = req.headers.authorization || "";
  const bearer = headerAuth.toLowerCase().startsWith("bearer ") ? headerAuth.slice(7).trim() : null;
  const queryToken = typeof req.query.token === "string" ? req.query.token : null;
  const cookies = parseCookies(req.headers.cookie || "");
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  return bearer || queryToken || cookieToken || null;
};

const resolveUserFromToken = async (rawToken, res = null) => {
  if (!rawToken) {
    const err = new Error("Token tidak ditemukan");
    err.status = 401;
    throw err;
  }

  let payload = null;
  let expired = false;
  try {
    payload = jwt.verify(String(rawToken), JWT_SECRET);
  } catch (err) {
    if (err?.name === "TokenExpiredError") {
      expired = true;
      try {
        payload = jwt.verify(String(rawToken), JWT_SECRET, { ignoreExpiration: true });
      } catch {
        payload = null;
      }
    }
  }

  const fetchUser = async () => {
    if (payload?.id) {
      return get(
        "SELECT id, username, telegram_id, is_admin, is_banned, session_token, balance, unique_code FROM users WHERE id = ?",
        [payload.id],
      );
    }
    if (payload?.sessionToken) {
      return get(
        "SELECT id, username, telegram_id, is_admin, is_banned, session_token, balance, unique_code FROM users WHERE session_token = ?",
        [payload.sessionToken],
      );
    }
    return get(
      "SELECT id, username, telegram_id, is_admin, is_banned, session_token, balance, unique_code FROM users WHERE session_token = ?",
      [rawToken],
    );
  };

  let user;
  try {
    user = await fetchUser();
  } catch (err) {
    if (err?.message?.includes("unique_code")) {
      await ensureUserUniqueCode();
      user = await fetchUser();
    } else {
      throw err;
    }
  }
  if (!user) {
    const err = new Error("Token tidak valid");
    err.status = 401;
    throw err;
  }

  const sessionToken = user.session_token || "";
  if (expired) {
    if (payload?.sessionToken && sessionToken && payload.sessionToken === sessionToken) {
      await run("UPDATE users SET session_token = ?, session_last_seen = ? WHERE id = ?", [
        crypto.randomUUID(),
        0,
        user.id,
      ]).catch(() => {});
      if (res) clearAuthCookie(res);
      const err = new Error("Sesi kadaluarsa");
      err.status = 401;
      throw err;
    }
    const err = new Error("Token tidak valid");
    err.status = 401;
    throw err;
  }

  let currentSession = sessionToken;
  if (!currentSession) {
    // Legacy users without session token: bind to incoming token or create a new session.
    const incoming = payload?.sessionToken || rawToken || crypto.randomUUID();
    currentSession = incoming || crypto.randomUUID();
    await run("UPDATE users SET session_token = ?, session_last_seen = ? WHERE id = ?", [
      currentSession,
      Date.now(),
      user.id,
    ]);
    user.session_token = currentSession;
  }

  const incomingSession = payload ? payload?.sessionToken ?? null : rawToken;
  if (!incomingSession || incomingSession !== currentSession) {
    // Refresh token/cookie to align with current session.
    if (res) {
      const fresh = issueToken({ ...user, session_token: currentSession });
      setAuthCookie(res, fresh);
    }
  }
  if (user.is_banned) {
    const err = new Error("Akun diblokir");
    err.status = 403;
    throw err;
  }
  await run("UPDATE users SET session_last_seen = ? WHERE id = ?", [Date.now(), user.id]).catch(() => {});
  return user;
};

const router = express.Router();

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const WHITELIST_TTL = 30 * 60 * 1000; // 30 minutes
const attempts = new Map(); // ip -> [timestamps]
const whitelist = new Map(); // ip -> expiresAt

const getClientIp = (req) => {
  const forwarded = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.connection?.remoteAddress || req.ip || "unknown";
};

const cleanupMaps = () => {
  const now = Date.now();
  for (const [ip, times] of attempts.entries()) {
    const filtered = times.filter((t) => now - t <= WINDOW_MS);
    if (filtered.length === 0) attempts.delete(ip);
    else attempts.set(ip, filtered);
  }
  for (const [ip, exp] of whitelist.entries()) {
    if (exp <= now) whitelist.delete(ip);
  }
};
setInterval(cleanupMaps, 60 * 1000).unref();

const authGuard = (req, res, next) => {
  const ip = getClientIp(req);
  const now = Date.now();
  if (whitelist.has(ip) && whitelist.get(ip) > now) {
    return next();
  }

  const records = attempts.get(ip) || [];
  const recent = records.filter((t) => now - t <= WINDOW_MS);
  recent.push(now);
  attempts.set(ip, recent);

  if (recent.length <= MAX_ATTEMPTS) {
    return next();
  }

  const { captchaId, captchaAnswer } = req.body || {};
  const captchaOk = validateCaptcha(captchaId, captchaAnswer);
  if (captchaOk) {
    whitelist.set(ip, now + WHITELIST_TTL);
    attempts.delete(ip);
    return next();
  }

  const challenge = generateCaptcha();
  return res.status(429).json({
    message: "Terlalu banyak percobaan. Isi captcha untuk lanjut.",
    requireCaptcha: true,
    captchaId: challenge.captchaId,
    captchaImage: challenge.image,
  });
};

router.get("/captcha", (_req, res) => {
  const captcha = generateCaptcha();
  res.json(captcha);
});

router.post("/auth/register", authGuard, async (req, res) => {
  const { username, password, confirmPassword, captchaId, captchaAnswer } = req.body || {};

  if (!username || !password || !confirmPassword) {
    return res.status(400).json({ message: "Username, password, dan konfirmasi wajib diisi" });
  }

  const trimmedUsername = username.trim();
  if (trimmedUsername.length < 3 || trimmedUsername.length > 32) {
    return res.status(400).json({ message: "Username harus 3-32 karakter" });
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(trimmedUsername)) {
    return res.status(400).json({ message: "Username hanya boleh huruf, angka, titik, strip, atau underscore" });
  }

  if (password.length < 8) {
    return res.status(400).json({ message: "Password minimal 8 karakter" });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ message: "Password tidak sama" });
  }

  const captchaOk = validateCaptcha(captchaId, captchaAnswer);
  if (!captchaOk) {
    return res.status(400).json({ message: "Captcha salah atau kadaluarsa" });
  }

  try {
    await ensureUserUniqueCode();
    const existing = await get("SELECT id FROM users WHERE username = ?", [trimmedUsername]);
    if (existing) {
      return res.status(409).json({ message: "Username sudah dipakai" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    const sessionToken = crypto.randomUUID();
    const uniqueCode = `U-${crypto.randomBytes(5).toString("hex")}`;
    const result = await run(
      "INSERT INTO users (username, password_hash, created_at, session_token, session_last_seen, balance, unique_code) VALUES (?, ?, ?, ?, ?, 0, ?)",
      [trimmedUsername, passwordHash, now, sessionToken, Date.now(), uniqueCode],
    );

    const user = {
      id: result.lastID,
      username: trimmedUsername,
      telegram_id: null,
      is_admin: 0,
      is_banned: 0,
      session_token: sessionToken,
      unique_code: uniqueCode,
    };
    const token = issueToken(user);
    setAuthCookie(res, token);
    return res.status(201).json({
      message: "Registrasi berhasil",
      token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    if (err?.message?.includes("unique_code")) {
      try {
        await ensureUserUniqueCode();
      } catch {
        /* ignore */
      }
      return res.status(503).json({ message: "Coba lagi sebentar, sedang menyiapkan kolom baru." });
    }
    console.error("Register error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.post("/auth/login", authGuard, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ message: "Username dan password wajib diisi" });
  }

  try {
    const fetchUser = async () =>
      get(
        "SELECT id, username, password_hash, telegram_id, is_admin, is_banned, balance, unique_code FROM users WHERE username = ?",
        [username.trim()],
      );
    let user;
    try {
      user = await fetchUser();
    } catch (err) {
      if (err?.message?.includes("unique_code")) {
        await ensureUserUniqueCode();
        user = await fetchUser();
      } else {
        throw err;
      }
    }
    if (!user) {
      return res.status(401).json({ message: "Kredensial salah" });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: "Kredensial salah" });
    }

    if (user.is_banned) {
      return res.status(403).json({ message: "Akun diblokir" });
    }

    const sessionToken = crypto.randomUUID();
    let uniqueCode = user.unique_code;
    if (!uniqueCode) {
      uniqueCode = `U-${crypto.randomBytes(5).toString("hex")}`;
      await run("UPDATE users SET unique_code = ? WHERE id = ?", [uniqueCode, user.id]);
    }
    await run("UPDATE users SET session_token = ?, session_last_seen = ? WHERE id = ?", [
      sessionToken,
      Date.now(),
      user.id,
    ]);
    const token = issueToken({ ...user, session_token: sessionToken });
    setAuthCookie(res, token);
    return res.json({
      message: "Login sukses",
      token,
      user: sanitizeUser({ ...user, unique_code: uniqueCode, balance: user.balance ?? 0 }),
    });
  } catch (err) {
    console.error("Login error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.post("/auth/reset", authenticate, authGuard, async (req, res) => {
  const { oldPassword, newPassword, confirmPassword } = req.body || {};
  if (!oldPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ message: "Semua field wajib diisi" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: "Password baru minimal 8 karakter" });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: "Password baru tidak sama" });
  }

  try {
    const user = await get("SELECT id, password_hash FROM users WHERE id = ?", [req.user.id]);
    if (!user) return res.status(404).json({ message: "User tidak ditemukan" });

    const match = await bcrypt.compare(oldPassword, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: "Password lama salah" });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await run("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, req.user.id]);

    return res.json({ message: "Password berhasil diperbarui" });
  } catch (err) {
    console.error("Reset password error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.post("/auth/logout", async (req, res) => {
  // Selalu kosongkan cookie sesi, bahkan jika token sudah kadaluarsa/invalid.
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE_NAME];

  clearAuthCookie(res);

  if (!token) {
    return res.json({ message: "Logout berhasil" });
  }

  try {
    const payload = jwt.verify(String(token), JWT_SECRET);
    if (payload?.id) {
      await run("UPDATE users SET session_token = ?, session_last_seen = ? WHERE id = ?", [
        crypto.randomUUID(),
        Date.now(),
        payload.id,
      ]);
    }
  } catch (err) {
    // Abaikan error verifikasi; cookie sudah dibersihkan.
  }

  return res.json({ message: "Logout berhasil" });
});

// Login CLI via unique code (no password) – intended for trusted tooling.
router.post("/auth/cli-login", async (req, res) => {
  const { uniqueCode, password } = req.body || {};
  const trimmed = typeof uniqueCode === "string" ? uniqueCode.trim() : "";
  if (!trimmed || trimmed.length < 6) {
    return res.status(400).json({ message: "Unique code wajib diisi" });
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ message: "Password wajib diisi dan minimal 8 karakter" });
  }
  try {
    const user = await get(
      "SELECT id, username, telegram_id, is_admin, is_banned, balance, unique_code, password_hash FROM users WHERE unique_code = ?",
      [trimmed],
    );
    if (!user) return res.status(401).json({ message: "Unique code atau password salah" });
    if (user.is_banned) return res.status(403).json({ message: "Akun diblokir" });

    const ok = await bcrypt.compare(password, user.password_hash || "");
    if (!ok) return res.status(401).json({ message: "Unique code atau password salah" });

    const sessionToken = crypto.randomUUID();
    await run("UPDATE users SET session_token = ?, session_last_seen = ? WHERE id = ?", [
      sessionToken,
      Date.now(),
      user.id,
    ]);
    const token = issueToken({ ...user, session_token: sessionToken });
    const plan = await getActiveUserPlan(user.id);
    setAuthCookie(res, token);
    return res.json({
      message: "Login CLI sukses",
      token,
      user: {
        username: user.username,
        balance: user.balance ?? 0,
        plan: plan
          ? {
              name: plan.name,
              maxConcurrent: plan.maxConcurrent,
              maxTime: plan.maxTime,
              premiumAccess: !!plan.premiumAccess,
              apiAccess: !!plan.apiAccess,
              expiresAt: plan.expiresAt || null,
            }
          : null,
      },
    });
  } catch (err) {
    console.error("CLI login error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.get("/auth/me", authenticate, async (req, res) => {
  try {
    const fetchUser = async () =>
      get(
        "SELECT id, username, telegram_id, is_admin, is_banned, balance, unique_code FROM users WHERE id = ?",
        [req.user.id],
      );
    let user;
    try {
      user = await fetchUser();
    } catch (err) {
      if (err?.message?.includes("unique_code")) {
        await ensureUserUniqueCode();
        user = await fetchUser();
      } else {
        throw err;
      }
    }
    if (!user) return res.status(404).json({ message: "User tidak ditemukan" });
    let uniqueCode = user.unique_code;
    if (!uniqueCode) {
      uniqueCode = `U-${crypto.randomBytes(5).toString("hex")}`;
      await run("UPDATE users SET unique_code = ? WHERE id = ?", [uniqueCode, user.id]);
    }
    const plan = await getActiveUserPlan(user.id);
    res.json({
      user: {
        ...sanitizeUser({ ...user, unique_code: uniqueCode, balance: user.balance ?? 0 }),
        plan: planSummary(plan),
      },
    });
  } catch (err) {
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

// Versi token-based tanpa middleware (untuk klien yang tidak bisa pakai cookie/credential).
// Ambil token dari Authorization: Bearer, query ?token=, atau cookie session.
router.get("/auth/me-lite", async (req, res) => {
  try {
    const token = extractToken(req);
    const user = await resolveUserFromToken(token, res);
    const plan = await getActiveUserPlan(user.id);
    return res.json({ user: { ...sanitizeUser(user), plan: planSummary(plan) } });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ message: err.message || "Token tidak valid" });
  }
});

// Alias endpoint profil yang sama, bisa dipakai klien publik (mis. fetch sederhana tanpa credential).
router.get("/auth/profile", async (req, res) => {
  try {
    const token = extractToken(req);
    const user = await resolveUserFromToken(token, res);
    const plan = await getActiveUserPlan(user.id);
    return res.json({ user: { ...sanitizeUser(user), plan: planSummary(plan) } });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ message: err.message || "Token tidak valid" });
  }
});

module.exports = router;

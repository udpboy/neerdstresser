const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const {
  JWT_SECRET,
  SESSION_COOKIE_NAME,
  COOKIE_SECURE,
  COOKIE_SAMESITE,
  SESSION_MAX_AGE_MS,
} = require("../config");
const { get, run, ensureUserUniqueCode } = require("../db");

const parseCookies = (cookieHeader = "") =>
  cookieHeader
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .reduce((acc, cur) => {
      const [k, ...rest] = cur.split("=");
      if (!k) return acc;
      acc[k] = rest.join("=");
      return acc;
    }, {});

const getBearerToken = (req) => {
  const header = req.headers.authorization || "";
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
};

const getQueryToken = (req) => (typeof req.query?.token === "string" ? req.query.token.trim() : "");

const getAuthTokens = (req) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const cookieToken = cookies[SESSION_COOKIE_NAME] || "";
  const bearerToken = getBearerToken(req);
  const queryToken = getQueryToken(req);
  const tokens = [];
  [bearerToken, queryToken, cookieToken].forEach((token) => {
    if (token && !tokens.includes(token)) tokens.push(token);
  });
  return tokens;
};

const decodeJwt = (token) => {
  try {
    return { payload: jwt.verify(token, JWT_SECRET), verified: true, expired: false };
  } catch (err) {
    if (err?.name === "TokenExpiredError") {
      try {
        const payload = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
        return { payload, verified: false, expired: true };
      } catch {
        return { payload: null, verified: false, expired: false };
      }
    }
    return { payload: null, verified: false, expired: false };
  }
};

const invalidateSession = (userId) =>
  run("UPDATE users SET session_token = ?, session_last_seen = ? WHERE id = ?", [
    crypto.randomUUID(),
    0,
    userId,
  ]).catch(() => {});

const issueToken = (user) =>
  jwt.sign(
    {
      id: user.id,
      username: user.username,
      telegramId: user.telegram_id ?? user.telegramId ?? null,
      isAdmin: Boolean(user.is_admin ?? user.isAdmin),
      sessionToken: user.session_token ?? user.sessionToken ?? null,
    },
    JWT_SECRET,
    { expiresIn: "24h" },
  );

const setAuthCookie = (res, token) => {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: COOKIE_SAMESITE,
    secure: COOKIE_SECURE,
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  });
};

const clearAuthCookie = (res) =>
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: COOKIE_SAMESITE,
    secure: COOKIE_SECURE,
    path: "/",
  });

const authenticate = async (req, res, next) => {
  const tokens = getAuthTokens(req);
  if (!tokens.length) {
    return res.status(401).json({ message: "Token tidak ditemukan" });
  }

  const fetchUserById = async (id) =>
    get(
      "SELECT id, username, telegram_id, is_admin, is_banned, session_token, session_last_seen, balance, unique_code FROM users WHERE id = ?",
      [id],
    );
  const fetchUserBySession = async (session) =>
    get(
      "SELECT id, username, telegram_id, is_admin, is_banned, session_token, session_last_seen, balance, unique_code FROM users WHERE session_token = ?",
      [session],
    );

  for (const rawToken of tokens) {
    const { payload, expired } = decodeJwt(rawToken);
    let userRow = null;
    try {
      if (payload?.id) {
        userRow = await fetchUserById(payload.id);
      }
      if (!userRow && payload?.sessionToken) {
        userRow = await fetchUserBySession(payload.sessionToken);
      }
      if (!userRow && !payload) {
        userRow = await fetchUserBySession(rawToken);
      }
    } catch (err) {
      if (err?.message?.includes("unique_code")) {
        await ensureUserUniqueCode();
        if (payload?.id) {
          userRow = await fetchUserById(payload.id);
        }
        if (!userRow && payload?.sessionToken) {
          userRow = await fetchUserBySession(payload.sessionToken);
        }
        if (!userRow && !payload) {
          userRow = await fetchUserBySession(rawToken);
        }
      } else {
        continue;
      }
    }

    if (!userRow) {
      continue;
    }

    const sessionToken = userRow.session_token || "";
    if (expired) {
      if (payload?.sessionToken && sessionToken && payload.sessionToken === sessionToken) {
        await invalidateSession(userRow.id);
        clearAuthCookie(res);
        return res.status(401).json({ message: "Sesi kadaluarsa" });
      }
      continue;
    }

    let currentSession = sessionToken;
    if (!currentSession) {
      currentSession = payload?.sessionToken || crypto.randomUUID();
      await run("UPDATE users SET session_token = ?, session_last_seen = ? WHERE id = ?", [
        currentSession,
        Date.now(),
        userRow.id,
      ]);
    }

    const incomingSession = payload ? payload?.sessionToken : rawToken;
    if (!incomingSession || incomingSession !== currentSession) {
      const freshToken = issueToken({ ...userRow, session_token: currentSession });
      setAuthCookie(res, freshToken);
    }

    if (userRow.is_banned) {
      return res.status(403).json({ message: "Akun diblokir" });
    }

    const now = Date.now();
    await run("UPDATE users SET session_last_seen = ? WHERE id = ?", [now, userRow.id]);
    req.user = {
      id: userRow.id,
      username: userRow.username,
      telegramId: userRow.telegram_id,
      isAdmin: Boolean(userRow.is_admin),
      sessionToken: currentSession,
      balance: userRow.balance ?? 0,
      uniqueCode: userRow.unique_code,
    };
    return next();
  }

  return res.status(401).json({ message: "Token tidak valid" });
};

const requireAdmin = (req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: "Akses admin diperlukan" });
  }
  return next();
};

module.exports = {
  issueToken,
  authenticate,
  requireAdmin,
  setAuthCookie,
  clearAuthCookie,
  parseCookies,
};

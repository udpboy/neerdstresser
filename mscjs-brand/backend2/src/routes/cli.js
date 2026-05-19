const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const net = require("net");
const jwt = require("jsonwebtoken");
const { run, get, all, withTransaction } = require("../db");
const { getActiveUserPlan } = require("../lib/plan");
const { logBalanceActivity } = require("../lib/balance");
const { generateCliCaptcha, validateCaptcha } = require("../lib/captcha");
const { JWT_SECRET } = require("../config");
const cliTools = require("../cli-tools");

const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const CAPTCHA_TTL_SEC = 10 * 60;

const MAX_BODY_CHARS = 512;
const MAX_CLI_SESSIONS_PER_USER = 5;
const SECURITY_EVENTS_RETENTION_MS = 30 * DAY_MS;
const MAX_COUNTER_POINTS = 50;
const MAP_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const CLI_BUSY_RETRY_AFTER_SEC = 2;
const CLI_MAX_INFLIGHT = 200;
const CLI_MAX_DB_INFLIGHT = 40;
const EVENT_LOOP_LAG_INTERVAL_MS = 250;
const EVENT_LOOP_LAG_THRESHOLD_MS = 500;

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const CAPTCHA_WINDOW_MS = 30 * 1000;
const MAX_CAPTCHA_PER_WINDOW = 8;
const MAX_LOGIN_PER_WINDOW = 20;
const MAX_LOGIN_PER_CODE_WINDOW = 12;
const PASSWORD_WINDOW_MS = 10 * 60 * 1000;
const MAX_PASSWORD_PER_WINDOW = 10;
const MAX_PASSWORD_PER_USER_WINDOW = 6;
const STORE_WINDOW_MS = 30 * 1000;
const MAX_STORE_BUY_PER_WINDOW = 4;
const STOP_WINDOW_MS = 20 * 1000;
const MAX_STOP_PER_WINDOW = 10;
const MAX_STOP_PER_USER_WINDOW = 8;
const RUN_WINDOW_MS = 20 * 1000;
const MAX_RUN_PER_WINDOW = 6;
const MAX_RUN_PER_USER_WINDOW = 4;
const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const MAX_REFRESH_PER_WINDOW = 25;
const MAX_REFRESH_PER_USER_WINDOW = 20;

const API_KEY_LENGTH = 10;
const API_KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const makeApiKey = (len = API_KEY_LENGTH) => {
  const bytes = crypto.randomBytes(Math.max(1, len));
  let out = "";
  for (let i = 0; i < len; i++) out += API_KEY_ALPHABET[bytes[i] % API_KEY_ALPHABET.length];
  return out;
};
const APIKEY_GEN_WINDOW_MS = 10 * 60 * 1000;
const MAX_APIKEY_GEN_PER_WINDOW = 6;
const MAX_APIKEY_GEN_PER_USER_WINDOW = 4;
const APIKEY_SETTINGS_WINDOW_MS = 60 * 1000;
const MAX_APIKEY_SETTINGS_PER_USER_WINDOW = 24;
const TOOLS_WINDOW_MS = 20 * 1000;
const MAX_TOOLS_RUN_PER_WINDOW = 8;
const MAX_TOOLS_RUN_PER_USER_WINDOW = 6;
const MAX_TOOL_INPUT_BYTES = 4 * 1024;

const captchaRequests = new Map(); // ip -> [timestamps]
const loginRequests = new Map(); // ip -> [timestamps]
const loginCodeRequests = new Map(); // code fingerprint -> [timestamps]
const passwordRequests = new Map(); // ip -> [timestamps]
const passwordUserRequests = new Map(); // user_id -> [timestamps]
const storeBuyRequests = new Map(); // ip -> [timestamps]
const storeBuyUserRequests = new Map(); // user_id -> [timestamps]
const storeBuyIpUserRequests = new Map(); // ip:user_id -> [timestamps]
const runRequests = new Map(); // ip -> [timestamps]
const runUserRequests = new Map(); // user_id -> [timestamps]
const runIpUserRequests = new Map(); // ip:user_id -> [timestamps]
const stopRequests = new Map(); // ip -> [timestamps]
const stopUserRequests = new Map(); // user_id -> [timestamps]
const stopIpUserRequests = new Map(); // ip:user_id -> [timestamps]
const refreshRequests = new Map(); // ip -> [timestamps]
const refreshUserRequests = new Map(); // user_id -> [timestamps]
const apiKeyGenRequests = new Map(); // ip -> [timestamps]
const apiKeyGenUserRequests = new Map(); // user_id -> [timestamps]
const apiKeySettingsUserRequests = new Map(); // user_id -> [timestamps]
const apiKeySettingsIpUserRequests = new Map(); // ip:user_id -> [timestamps]
const toolsRunRequests = new Map(); // ip -> [timestamps]
const toolsRunUserRequests = new Map(); // user_id -> [timestamps]
const captchaCooldown = new Map(); // ip -> cooldownUntil (ms)
const CAPTCHA_COOLDOWN_MS = 30 * 1000;

const getClientIp = (req) => {
  // Use Express's `req.ip` which already respects the configured `trust proxy` chain.
  // Do NOT parse `x-forwarded-for` manually here, otherwise clients can spoof IPs and bypass rate limits.
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || "unknown";
};

let cliInflight = 0;
let cliDbInflight = 0;
let eventLoopLagMs = 0;
let eventLoopExpected = Date.now() + EVENT_LOOP_LAG_INTERVAL_MS;
setInterval(() => {
  const now = Date.now();
  const lag = now - eventLoopExpected;
  eventLoopLagMs = lag > 0 ? lag : 0;
  eventLoopExpected = now + EVENT_LOOP_LAG_INTERVAL_MS;
}, EVENT_LOOP_LAG_INTERVAL_MS).unref?.();

const isCliOverloaded = () => cliInflight > CLI_MAX_INFLIGHT || eventLoopLagMs > EVENT_LOOP_LAG_THRESHOLD_MS;

const respondCliBusy = (res, reason = "Server sibuk") => {
  res.set("Retry-After", String(CLI_BUSY_RETRY_AFTER_SEC));
  return res.status(503).json({
    message: `${reason}. Coba lagi sebentar.`,
    overloaded: true,
    retryAfterSec: CLI_BUSY_RETRY_AFTER_SEC,
  });
};

// CLI endpoints don't need browser CORS at all; strip CORS headers to reduce browser attack surface.
// Also make sure responses are not cached (tokens, captcha, API keys, etc).
router.use((req, res, next) => {
  cliInflight += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    cliInflight = Math.max(0, cliInflight - 1);
  };
  res.on("finish", release);
  res.on("close", release);

  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.headers.origin) {
    res.removeHeader("Access-Control-Allow-Origin");
    res.removeHeader("Access-Control-Allow-Credentials");
    res.removeHeader("Access-Control-Allow-Headers");
    res.removeHeader("Access-Control-Allow-Methods");

    // Never allow state-changing browser requests to CLI routes.
    if (req.method !== "GET" && req.method !== "HEAD") {
      return res.status(403).json({ message: "CLI endpoint hanya untuk client non-browser" });
    }
  }

  if (isCliOverloaded()) {
    return respondCliBusy(res);
  }
  return next();
});

const requireCliDbSlot = (req, res, next) => {
  if (isCliOverloaded()) return respondCliBusy(res);
  if (cliDbInflight >= CLI_MAX_DB_INFLIGHT) return respondCliBusy(res, "Terlalu banyak request");

  cliDbInflight += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    cliDbInflight = Math.max(0, cliDbInflight - 1);
  };
  res.on("finish", release);
  res.on("close", release);
  return next();
};

const requireJson = (req, res, next) => {
  if (!req.is("application/json")) {
    return res.status(415).json({ message: "Content-Type harus application/json" });
  }
  return next();
};

const trimStr = (value, max = MAX_BODY_CHARS) => {
  const s = typeof value === "string" ? value : String(value || "");
  if (!max) return s;
  return s.length > max ? s.slice(0, max) : s;
};

const stripAnsi = (input) => {
  let s = String(input ?? "");
  // OSC: ESC ] ... BEL or ESC \
  s = s.replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "");
  // CSI: ESC [ ... final byte
  s = s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
  // C1 CSI
  s = s.replace(/\x9B[0-?]*[ -/]*[@-~]/g, "");
  // 2-char sequences
  s = s.replace(/\x1B[@-Z\\-_]/g, "");
  // Safety: remove any leftover ESC
  s = s.replace(/\x1B/g, "");
  return s;
};

const sanitizeTerminalText = (value, maxLength = 10_000) => {
  let s = String(value ?? "");
  if (!s) return "";
  s = stripAnsi(s);
  s = s.replace(/\r/g, "\n");
  // Remove control chars (keep \n and \t)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
  if (Number.isFinite(maxLength) && maxLength > 0 && s.length > maxLength) {
    if (maxLength === 1) return "…";
    return `${s.slice(0, maxLength - 1)}…`;
  }
  return s;
};

const sanitizeCliPlain = (value, maxLength) =>
  sanitizeTerminalText(value, maxLength)
    .replace(/[<>"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const sanitizeCliMultiline = (value, maxLength = 10_000) => {
  const s = sanitizeTerminalText(value, maxLength);
  return s
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
};

const maskSecrets = (value, secrets, replacement = "[REDACTED]") => {
  let s = String(value ?? "");
  if (!s) return "";
  const list = Array.from(
    new Set(
      (Array.isArray(secrets) ? secrets : [])
        .map((v) => (typeof v === "string" ? v : ""))
        .map((v) => v.trim())
        .filter((v) => v && v.length >= 8),
    ),
  ).sort((a, b) => b.length - a.length);
  for (const secret of list) {
    s = s.split(secret).join(replacement);
  }
  return s;
};

const escapeRegExp = (value) => String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeHostInput = (value) => {
  const raw = sanitizeTerminalText(trimStr(value, 260), 260).trim();
  if (!raw) return "";
  if (raw.includes("\n") || raw.includes("\t")) return "";

  let s = raw;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  // Remove path/query/fragment.
  s = s.split(/[/?#]/)[0];

  // Reject userinfo / weird separators early.
  if (s.includes("@")) return "";
  if (s.includes("\\") || s.includes("%")) return "";
  if (/[<>"'`]/.test(s)) return "";
  if (/\s/.test(s)) return "";

  s = s.trim().toLowerCase();
  if (!s || s.length > 220) return "";

  const match = s.match(/^([a-z0-9.-]+)(?::(\d{1,5}))?$/i);
  if (!match) return "";
  const host = match[1];
  const port = match[2] ? Number(match[2]) : null;

  if (port !== null) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "";
  }

  if (net.isIP(host)) return port !== null ? `${host}:${port}` : host;

  if (host === "localhost") return port !== null ? `${host}:${port}` : host;

  if (host.length < 3) return "";
  if (host.startsWith(".") || host.endsWith(".")) return "";
  if (host.includes("..")) return "";
  if (!/^[a-z0-9.-]+$/.test(host)) return "";

  const labels = host.split(".");
  if (labels.some((l) => !l)) return "";
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return "";
    if (label.startsWith("-") || label.endsWith("-")) return "";
    if (!/^[a-z0-9-]+$/.test(label)) return "";
  }

  return port !== null ? `${host}:${port}` : host;
};

const normalizeParamKey = (value) => {
  const raw = sanitizeTerminalText(value ?? "", 80).trim();
  if (!raw) return "";
  // Keep CLI params compatible with existing backend templates/DB keys.
  // Allow a restricted set of non-whitespace printable chars (no quotes/braces/spaces/control).
  // Examples in DB may look like "[test]" so we allow brackets.
  if (raw.length > 64) return "";
  if (/\s/.test(raw)) return "";
  if (!/^[A-Za-z0-9._\-\[\]]+$/.test(raw)) return "";
  return raw;
};

const normalizeMethodType = (value) => {
  const s = sanitizeTerminalText(value ?? "", 32).trim().toLowerCase();
  if (!s) return "string";
  if (s === "checkbox" || s === "number" || s === "select") return s;
  return "string";
};

const normalizeToolInputType = (value) => {
  const s = sanitizeTerminalText(value ?? "", 32).trim().toLowerCase();
  if (!s) return "string";
  if (s === "checkbox" || s === "number" || s === "select" || s === "password") return s;
  return "string";
};

const sanitizeToolInputDefForCli = (def) => {
  const key = normalizeParamKey(def?.key ?? def?.id ?? def?.name ?? "");
  if (!key) return null;
  const type = normalizeToolInputType(def?.type);
  const label = sanitizeCliPlain(def?.label ?? key, 64) || key;
  const required = !!def?.required;
  const placeholder = sanitizeCliPlain(def?.placeholder ?? "", 180);

  let options = [];
  if (type === "select") {
    const rawOptions = Array.isArray(def?.options)
      ? def.options
      : typeof def?.options === "string"
        ? def.options.split(",")
        : [];
    options = rawOptions
      .map((o) => sanitizeCliPlain(o, 64))
      .filter(Boolean)
      .slice(0, 50);
  }

  let defaultValue = def?.default;
  if (defaultValue === undefined) defaultValue = def?.default_value;

  let safeDefault = null;
  if (defaultValue !== undefined && defaultValue !== null) {
    if (type === "checkbox") {
      safeDefault = !!defaultValue;
    } else if (type === "number") {
      const n = typeof defaultValue === "number" ? defaultValue : Number(String(defaultValue));
      safeDefault = Number.isFinite(n) ? n : null;
    } else {
      const s = sanitizeTerminalText(String(defaultValue), 200).trim();
      safeDefault = s ? s : null;
    }
  }
  if (type === "select" && safeDefault && options.length && !options.includes(String(safeDefault))) safeDefault = null;

  return {
    key,
    label,
    type,
    required,
    placeholder,
    options,
    default: safeDefault,
  };
};

const sanitizeToolForCli = (tool) => {
  const id = sanitizeCliPlain(tool?.id ?? "", 64);
  if (!id) return null;
  const name = sanitizeCliPlain(tool?.name ?? id, 120) || id;
  const description = sanitizeTerminalText(tool?.description ?? "", 500)
    .replace(/[<>"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const rawInputs = Array.isArray(tool?.inputs) ? tool.inputs : [];
  const inputs = rawInputs.map(sanitizeToolInputDefForCli).filter(Boolean).slice(0, 20);
  return { id, name, description, inputs, hasInput: inputs.length > 0 };
};

const validateToolRunInput = (tool, rawInput) => {
  const defs = Array.isArray(tool?.inputs) ? tool.inputs.map(sanitizeToolInputDefForCli).filter(Boolean) : [];
  const byKey = new Map(defs.map((d) => [d.key, d]));

  if (rawInput === undefined || rawInput === null) rawInput = {};
  if (rawInput !== null && typeof rawInput !== "object") {
    const err = new Error("Input harus object JSON");
    err.status = 400;
    throw err;
  }

  const keys = Object.keys(rawInput || {});
  if (keys.length > 50) {
    const err = new Error("Terlalu banyak field input");
    err.status = 400;
    throw err;
  }

  for (const k of keys) {
    if (!byKey.has(k)) {
      const err = new Error("Input tidak valid");
      err.status = 400;
      throw err;
    }
  }

  const out = {};
  for (const def of defs) {
    const has = Object.prototype.hasOwnProperty.call(rawInput, def.key);
    let value = has ? rawInput[def.key] : undefined;

    const missing =
      value === undefined || value === null || (typeof value === "string" && value.trim() === "");

    if (missing) {
      if (def.default !== null && def.default !== undefined) {
        value = def.default;
      } else if (def.required) {
        const err = new Error(`${def.label} wajib diisi`);
        err.status = 400;
        throw err;
      } else {
        continue;
      }
    }

    if (def.type === "checkbox") {
      if (typeof value === "boolean") {
        out[def.key] = value;
        continue;
      }
      if (typeof value === "string") {
        const s = value.trim().toLowerCase();
        if (s === "true") {
          out[def.key] = true;
          continue;
        }
        if (s === "false") {
          out[def.key] = false;
          continue;
        }
      }
      const err = new Error(`${def.label} harus boolean`);
      err.status = 400;
      throw err;
    }

    if (def.type === "number") {
      const n = typeof value === "number" ? value : Number(String(value));
      if (!Number.isFinite(n)) {
        const err = new Error(`${def.label} harus angka`);
        err.status = 400;
        throw err;
      }
      if (Math.abs(n) > 1e9) {
        const err = new Error(`${def.label} terlalu besar`);
        err.status = 400;
        throw err;
      }
      out[def.key] = n;
      continue;
    }

    if (def.type === "select") {
      const s = sanitizeTerminalText(String(value), 200).trim();
      if (!s) {
        if (def.required) {
          const err = new Error(`${def.label} wajib dipilih`);
          err.status = 400;
          throw err;
        }
        continue;
      }
      if (def.options?.length && !def.options.includes(s)) {
        const err = new Error(`${def.label} tidak valid`);
        err.status = 400;
        throw err;
      }
      out[def.key] = s;
      continue;
    }

    const s = sanitizeTerminalText(String(value), 1200)
      .replace(/\r/g, "\n")
      .trim();
    if (!s) {
      if (def.required) {
        const err = new Error(`${def.label} wajib diisi`);
        err.status = 400;
        throw err;
      }
      continue;
    }
    out[def.key] = s.slice(0, 800);
  }

  return Object.keys(out).length ? out : null;
};

const sanitizeMethodForCli = (row, params) => {
  const id = Number(row?.id) || 0;
  const name = sanitizeCliPlain(row?.name ?? "", 64);
  const displayName = sanitizeCliPlain(row?.display_name ?? row?.displayName ?? "", 120);
  const layer = sanitizeCliPlain(row?.layer ?? "", 16);
  const tier = sanitizeCliPlain(row?.tier ?? "", 16);
  const audience = sanitizeCliPlain(row?.audience ?? "", 16);
  const description = sanitizeTerminalText(row?.description ?? "", 1500).replace(/[<>"'`]/g, "").trim();

  const safeParams = [];
  for (const p of params || []) {
    const key = normalizeParamKey(p?.param_key || p?.key);
    if (!key) continue;
    const type = normalizeMethodType(p?.type);
    safeParams.push({
      id: Number(p?.id) || 0,
      param_key: key,
      label: sanitizeCliPlain(p?.label ?? key, 64) || key,
      type,
      required: !!p?.required,
      placeholder: sanitizeCliPlain(p?.placeholder ?? "", 180),
      default_value:
        p?.default_value === null || p?.default_value === undefined ? null : sanitizeTerminalText(String(p.default_value), 200).trim(),
      options:
        sanitizeCliPlain(p?.options ?? "", 800)
          .split(",")
          .map((o) => sanitizeCliPlain(o, 64))
          .filter(Boolean)
          .slice(0, 50)
          .join(","),
    });
  }

  return {
    id,
    name,
    display_name: displayName || name || "-",
    layer,
    tier,
    audience,
    description,
    params: safeParams,
  };
};

const allowInWindow = (map, key, max, windowMs) => {
  const now = Date.now();
  const arr = map.get(key) || [];
  const next = arr.filter((t) => now - t <= windowMs);
  if (next.length >= max) {
    map.set(key, next);
    return false;
  }
  next.push(now);
  map.set(key, next);
  return true;
};

const rateLimitInfo = (map, key, max, windowMs) => {
  const now = Date.now();
  const arr = map.get(key) || [];
  const next = arr.filter((t) => now - t <= windowMs);
  if (next.length >= max) {
    map.set(key, next);
    const oldest = next[0] || now;
    const retryAfterMs = Math.max(1, windowMs - (now - oldest));
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  next.push(now);
  map.set(key, next);
  return { allowed: true, retryAfterSec: 0 };
};

let cliSecuritySchemaReady = null;
const ensureCliSecuritySchema = async () => {
  if (cliSecuritySchemaReady) return cliSecuritySchemaReady;
  cliSecuritySchemaReady = (async () => {
    await run(
      `CREATE TABLE IF NOT EXISTS cli_security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        type TEXT NOT NULL,
        ip TEXT NOT NULL,
        user_id INTEGER,
        user_agent TEXT,
        message TEXT,
        meta TEXT
      )`,
    );
    await run("CREATE INDEX IF NOT EXISTS idx_cli_security_events_created_at ON cli_security_events(created_at)");
    await run("CREATE INDEX IF NOT EXISTS idx_cli_security_events_type ON cli_security_events(type)");
    await run("CREATE INDEX IF NOT EXISTS idx_cli_security_events_user_id ON cli_security_events(user_id)");
  })();
  return cliSecuritySchemaReady;
};

const recordCliSecurityEvent = async (req, { type, userId = null, message = null, meta = null }) => {
  try {
    if (isCliOverloaded()) return;
    if (cliDbInflight >= CLI_MAX_DB_INFLIGHT) return;
    await ensureCliSchema();
    await ensureCliSecuritySchema();
    const ip = getClientIp(req);
    const ua = trimStr(req.headers["user-agent"] || "", 220);
    const msg = message ? trimStr(message, 220) : null;
    const metaStr = meta ? trimStr(JSON.stringify(meta), 1000) : null;
    await run(
      "INSERT INTO cli_security_events (created_at, type, ip, user_id, user_agent, message, meta) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [Date.now(), String(type), String(ip), userId === null ? null : Number(userId) || null, ua || null, msg, metaStr],
    );
  } catch {
    // best-effort only
  }
};

const recordCliSecurityEventOnce = async (
  req,
  { type, userId = null, message = null, meta = null },
  windowMs = 10 * 60 * 1000,
) => {
  try {
    const ip = getClientIp(req);
    const key = `evt:${String(type)}:${ip}:${userId === null ? "na" : String(userId)}`;
    if (!oncePerWindow(alertCooldown, key, windowMs)) return;
  } catch {
    // ignore
  }
  await recordCliSecurityEvent(req, { type, userId, message, meta });
};

const bumpCounter = (map, key, windowMs) => {
  const now = Date.now();
  const arr = map.get(key) || [];
  const next = arr.filter((t) => now - t <= windowMs);
  next.push(now);
  if (next.length > MAX_COUNTER_POINTS) {
    next.splice(0, next.length - MAX_COUNTER_POINTS);
  }
  map.set(key, next);
  return next.length;
};

const oncePerWindow = (map, key, windowMs) => {
  const now = Date.now();
  const last = map.get(key) || 0;
  if (last && now - last <= windowMs) return false;
  map.set(key, now);
  return true;
};

const loginFailCounters = new Map(); // ip -> [timestamps]
const tokenInvalidCounters = new Map(); // ip -> [timestamps]
const refreshFailCounters = new Map(); // ip -> [timestamps]
const alertCooldown = new Map(); // key -> lastAt

const validateUniqueCode = (code) => {
  const s = typeof code === "string" ? code.trim() : "";
  if (s.length < 6 || s.length > 64) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(s)) return null;
  return s;
};

const validatePassword = (password) => {
  const s = typeof password === "string" ? password : "";
  if (s.length < 8 || s.length > 128) return null;
  return s;
};

const validateRefreshToken = (token) => {
  const s = typeof token === "string" ? token.trim() : "";
  if (!/^[a-f0-9]{64}$/i.test(s)) return null;
  return s;
};

const uaSignature = (ua) => {
  try {
    return crypto.createHash("sha1").update(String(ua || "")).digest("hex").slice(0, 10);
  } catch {
    return "na";
  }
};

const isSuspiciousUa = (ua) => {
  const s = String(ua || "").trim();
  if (!s) return true;
  if (s.length > 220) return true;
  if (/curl|wget|httpie|python|scrapy|selenium|puppeteer|playwright|bot|spider/i.test(s)) return true;
  return false;
};

const maybeLogSuspiciousClient = async (req, userId = null) => {
  const ip = getClientIp(req);
  const ua = trimStr(req.headers["user-agent"] || "", 400);
  if (!isSuspiciousUa(ua)) return;
  const sig = uaSignature(ua);
  const key = `suspicious:${ip}:${sig}`;
  if (!oncePerWindow(alertCooldown, key, 60 * 60 * 1000)) return;
  await recordCliSecurityEvent(req, {
    type: "suspicious.client",
    userId,
    message: "Suspicious client user-agent",
    meta: { ua: trimStr(ua, 220) },
  });
};

const getCooldownRemainingSec = (untilMs) => Math.max(1, Math.ceil((untilMs - Date.now()) / 1000));

const respondCaptchaCooldown = (res, untilMs) => {
  const retryAfterSec = getCooldownRemainingSec(untilMs);
  res.set("Retry-After", String(retryAfterSec));
  return res.status(429).json({
    message: `Terlalu banyak refresh captcha. Tunggu ${retryAfterSec}s`,
    rateLimited: true,
    retryAfterSec,
    cooldownUntil: untilMs,
  });
};

const captchaGate = (ip, res = null) => {
  const now = Date.now();
  const until = captchaCooldown.get(ip) || 0;
  if (until && until > now) {
    if (res) respondCaptchaCooldown(res, until);
    return false;
  }
  if (until && until <= now) captchaCooldown.delete(ip);
  if (!allowInWindow(captchaRequests, ip, MAX_CAPTCHA_PER_WINDOW, CAPTCHA_WINDOW_MS)) {
    const nextUntil = now + CAPTCHA_COOLDOWN_MS;
    captchaCooldown.set(ip, nextUntil);
    captchaRequests.delete(ip); // reset counter after cooldown as requested
    if (res) respondCaptchaCooldown(res, nextUntil);
    return false;
  }
  return true;
};

const issueCaptchaChallenge = (req, res, status, message) => {
  const ip = getClientIp(req);
  if (!captchaGate(ip, res)) return null;
  const challenge = generateCliCaptcha();
  return res.status(status).json({
    message,
    requireCaptcha: true,
    captchaId: challenge.captchaId,
    captcha: challenge.captcha,
    expiresInSec: CAPTCHA_TTL_SEC,
  });
};

let cliSchemaReady = null;
const ensureCliSchema = async () => {
  if (cliSchemaReady) return cliSchemaReady;
  cliSchemaReady = (async () => {
    await run(
      `CREATE TABLE IF NOT EXISTS cli_sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        refresh_token_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
    );
    await run("CREATE INDEX IF NOT EXISTS idx_cli_sessions_user_id ON cli_sessions(user_id)");
    await run("CREATE INDEX IF NOT EXISTS idx_cli_sessions_refresh_hash ON cli_sessions(refresh_token_hash)");
    await run("CREATE INDEX IF NOT EXISTS idx_cli_sessions_expires_at ON cli_sessions(expires_at)");
    await ensureCliSecuritySchema();
  })();
  return cliSchemaReady;
};

let lastCliSessionCleanupAt = 0;
const cleanupExpiredSessions = async (force = false) => {
  const now = Date.now();
  if (!force && lastCliSessionCleanupAt && now - lastCliSessionCleanupAt < 30 * 1000) return;
  lastCliSessionCleanupAt = now;
  await run("DELETE FROM cli_sessions WHERE expires_at <= ?", [now]).catch(() => {});
};

const pruneUserSessions = async (userId, keepSessionId = null) => {
  try {
    const rows = await all("SELECT id FROM cli_sessions WHERE user_id = ? ORDER BY last_seen DESC", [userId]);
    if (!Array.isArray(rows) || rows.length <= MAX_CLI_SESSIONS_PER_USER) return;
    const keep = new Set();
    if (keepSessionId) keep.add(String(keepSessionId));
    const toDelete = [];
    for (const row of rows) {
      const id = String(row?.id || "");
      if (!id) continue;
      if (keep.has(id)) continue;
      if (keep.size < MAX_CLI_SESSIONS_PER_USER) {
        keep.add(id);
        continue;
      }
      toDelete.push(id);
    }
    for (const id of toDelete) {
      await run("DELETE FROM cli_sessions WHERE id = ?", [id]).catch(() => {});
    }
  } catch {
    // best-effort
  }
};

const hashToken = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");
const makeRefreshToken = () => crypto.randomBytes(32).toString("hex");
const makeSessionId = () => crypto.randomUUID();

const codeFingerprint = (uniqueCode) => {
  if (!uniqueCode) return null;
  try {
    return crypto.createHmac("sha256", JWT_SECRET).update(String(uniqueCode)).digest("hex").slice(0, 10);
  } catch {
    return null;
  }
};

const issueCliToken = (sessionId) =>
  jwt.sign(
    {
      typ: "cli",
      sid: sessionId,
    },
    JWT_SECRET,
    { expiresIn: "24h", algorithm: "HS256" },
  );

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

const sanitizeUser = (user, plan) => ({
  username: user.username,
  balance: user.balance ?? 0,
  fingerprint: codeFingerprint(user.unique_code),
  plan: planSummary(plan),
});

const extractBearer = (req) => {
  const header = String(req.headers.authorization || "");
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim() || null;
};

const requireCliSession = async (req) => {
  const ip = getClientIp(req);
  const ua = trimStr(req.headers["user-agent"] || "", 220);
  await maybeLogSuspiciousClient(req, null);
  const raw = extractBearer(req);
  if (!raw) {
    const count = bumpCounter(tokenInvalidCounters, ip, 2 * 60 * 1000);
    if (count >= 8 && oncePerWindow(alertCooldown, `token-missing:${ip}`, 10 * 60 * 1000)) {
      await recordCliSecurityEvent(req, { type: "alert.token_missing_spike", message: "Token missing spike", meta: { count, ua } });
    }
    await recordCliSecurityEventOnce(req, { type: "auth.missing_token", message: "Token not found", meta: { ua } });
    const err = new Error("Token tidak ditemukan");
    err.status = 401;
    throw err;
  }
  let payload;
  try {
    payload = jwt.verify(raw, JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    const count = bumpCounter(tokenInvalidCounters, ip, 2 * 60 * 1000);
    if (count >= 8 && oncePerWindow(alertCooldown, `token-invalid:${ip}`, 10 * 60 * 1000)) {
      await recordCliSecurityEvent(req, { type: "alert.token_invalid_spike", message: "Token invalid spike", meta: { count, ua } });
    }
    await recordCliSecurityEventOnce(req, { type: "auth.invalid_token", message: "Token invalid", meta: { ua } });
    const err = new Error("Token tidak valid");
    err.status = 401;
    throw err;
  }
  if (!payload || payload.typ !== "cli" || !payload.sid) {
    await recordCliSecurityEventOnce(req, { type: "auth.invalid_token", message: "Token invalid payload", meta: { ua } });
    const err = new Error("Token tidak valid");
    err.status = 401;
    throw err;
  }
  const session = await get("SELECT id, user_id, created_at, expires_at FROM cli_sessions WHERE id = ?", [
    payload.sid,
  ]);
  if (!session) {
    await recordCliSecurityEventOnce(req, { type: "auth.invalid_session", message: "Session not found", meta: { ua } });
    const err = new Error("Token tidak valid");
    err.status = 401;
    throw err;
  }
  if (session.expires_at <= Date.now()) {
    await run("DELETE FROM cli_sessions WHERE id = ?", [session.id]).catch(() => {});
    await recordCliSecurityEventOnce(req, { type: "auth.session_expired", userId: session.user_id, message: "Session expired", meta: { ua } }, 5 * 60 * 1000);
    const err = new Error("Sesi kadaluarsa");
    err.status = 401;
    throw err;
  }
  await run("UPDATE cli_sessions SET last_seen = ? WHERE id = ?", [Date.now(), session.id]).catch(() => {});
  return session;
};

router.get("/captcha", (req, res) => {
  const ip = getClientIp(req);
  if (!captchaGate(ip, res)) return;
  const challenge = generateCliCaptcha();
  return res.json({ captchaId: challenge.captchaId, captcha: challenge.captcha, expiresInSec: CAPTCHA_TTL_SEC });
});

router.get("/status", (req, res) => {
  return res.json({
    message: "OK",
    serverTime: Date.now(),
    inflight: cliInflight,
    dbInflight: cliDbInflight,
    eventLoopLagMs,
    overloaded: isCliOverloaded(),
  });
});

router.get("/tools", requireCliDbSlot, async (req, res) => {
  try {
    const session = await requireCliSession(req);
    const user = await get("SELECT id, username, is_admin, is_banned FROM users WHERE id = ?", [session.user_id]);
    if (!user) return res.status(401).json({ message: "Token tidak valid" });
    if (user.is_banned) return res.status(403).json({ message: "Akun diblokir" });

    const plan = await getActiveUserPlan(user.id);
    const planId = plan?.id ?? null;
    const tools = cliTools
      .listTools({ planId })
      .map(sanitizeToolForCli)
      .filter(Boolean);
    return res.json({ tools });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ message: err?.message || "Gagal memuat tools" });
  }
});

router.post("/tools/run", requireJson, requireCliDbSlot, async (req, res) => {
  const ip = getClientIp(req);
  let bearerToken = null;
  try {
    const rlIp = rateLimitInfo(toolsRunRequests, ip, MAX_TOOLS_RUN_PER_WINDOW, TOOLS_WINDOW_MS);
    if (!rlIp.allowed) {
      res.set("Retry-After", String(rlIp.retryAfterSec));
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }

    const session = await requireCliSession(req);
    bearerToken = extractBearer(req);
    const rlUser = rateLimitInfo(toolsRunUserRequests, String(session.user_id), MAX_TOOLS_RUN_PER_USER_WINDOW, TOOLS_WINDOW_MS);
    if (!rlUser.allowed) {
      res.set("Retry-After", String(rlUser.retryAfterSec));
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }

    const user = await get("SELECT id, username, is_admin, is_banned FROM users WHERE id = ?", [session.user_id]);
    if (!user) return res.status(401).json({ message: "Token tidak valid" });
    if (user.is_banned) return res.status(403).json({ message: "Akun diblokir" });

    const toolId = sanitizeCliPlain(req.body?.toolId ?? req.body?.id ?? "", 64);
    if (!toolId) return res.status(400).json({ message: "toolId wajib" });
    const tool = cliTools.getTool(toolId);
    const plan = await getActiveUserPlan(user.id);
    const planId = plan?.id ?? null;
    if (!tool || !cliTools.isToolAllowed(tool, { planId })) {
      return res.status(404).json({ message: "Tool tidak ditemukan" });
    }

    const rawInput = req.body?.input;
    const bytes = Buffer.byteLength(JSON.stringify(rawInput ?? null), "utf8");
    if (bytes > MAX_TOOL_INPUT_BYTES) return res.status(400).json({ message: "Input terlalu besar" });
    const input = validateToolRunInput(tool, rawInput);

    const ctx = {
      ip,
      userAgent: trimStr(req.headers["user-agent"] || "", 220),
      token: bearerToken,
      authHeader: bearerToken ? `Bearer ${bearerToken}` : null,
      user: { id: user.id, username: user.username, isAdmin: !!user.is_admin },
      session: { id: session.id, userId: session.user_id },
    };

    const timeoutMs = 12_000;
    const startedAt = Date.now();
    const result = await Promise.race([
      Promise.resolve().then(() => tool.run(ctx, input)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Tool timeout")), timeoutMs)),
    ]);
    const durationMs = Date.now() - startedAt;

    const secrets = [];
    if (bearerToken) {
      secrets.push(bearerToken);
      secrets.push(`Bearer ${bearerToken}`);
    }
    const inputObj = input && typeof input === "object" ? input : null;
    const defs = Array.isArray(tool?.inputs) ? tool.inputs : [];
    for (const def of defs) {
      if (normalizeToolInputType(def?.type) !== "password") continue;
      const key = normalizeParamKey(def?.key ?? def?.id ?? def?.name ?? "");
      if (!key) continue;
      const v = inputObj?.[key];
      if (typeof v === "string" && v.trim().length >= 8) secrets.push(v.trim());
    }

    const output = sanitizeCliMultiline(maskSecrets(result?.output ?? "", secrets), 12_000);
    const data = result?.data && typeof result.data === "object" ? result.data : null;

    return res.json({
      message: "OK",
      tool: { id: toolId, name: sanitizeCliPlain(tool.name || toolId, 120) },
      durationMs,
      output,
      data,
    });
  } catch (err) {
    await recordCliSecurityEventOnce(
      req,
      { type: "tools.run_failed", message: "Tool run failed", meta: { ip, err: String(err?.message || err) } },
      60 * 1000,
    );
    const status = err?.status || 500;
    const msg = maskSecrets(err?.message || "Tool gagal dijalankan", bearerToken ? [bearerToken, `Bearer ${bearerToken}`] : []);
    return res.status(status).json({ message: msg || "Tool gagal dijalankan" });
  }
});

// CLI-specific login to avoid impacting existing auth flows (no cookie/session_token touch).
router.post("/login", requireJson, requireCliDbSlot, async (req, res) => {
  const { uniqueCode, password } = req.body || {};
  const captchaId = req.body?.captchaId;
  const captchaAnswer = req.body?.captchaAnswer;
  const code = validateUniqueCode(uniqueCode);
  const pass = validatePassword(password);
  if (!code) return res.status(400).json({ message: "Unique code wajib diisi" });
  if (!pass) return res.status(400).json({ message: "Password minimal 8 karakter" });

  try {
    const ip = getClientIp(req);
    await maybeLogSuspiciousClient(req, null);
    const rlIp = rateLimitInfo(loginRequests, ip, MAX_LOGIN_PER_WINDOW, LOGIN_WINDOW_MS);
    if (!rlIp.allowed) {
      res.set("Retry-After", String(rlIp.retryAfterSec));
      await recordCliSecurityEventOnce(
        req,
        { type: "rate_limit.login_ip", message: "Login rate limited (ip)", meta: { retryAfterSec: rlIp.retryAfterSec } },
        60 * 1000,
      );
      return res.status(429).json({ message: "Terlalu banyak percobaan, coba lagi nanti" });
    }
    const codeKey = codeFingerprint(code) || code;
    const rlCode = rateLimitInfo(loginCodeRequests, codeKey, MAX_LOGIN_PER_CODE_WINDOW, LOGIN_WINDOW_MS);
    if (!rlCode.allowed) {
      res.set("Retry-After", String(rlCode.retryAfterSec));
      await recordCliSecurityEventOnce(
        req,
        { type: "rate_limit.login_code", message: "Login rate limited (code)", meta: { retryAfterSec: rlCode.retryAfterSec } },
        60 * 1000,
      );
      return res.status(429).json({ message: "Terlalu banyak percobaan, coba lagi nanti" });
    }

    if (!captchaId || typeof captchaAnswer !== "string") {
      return issueCaptchaChallenge(req, res, 400, "Captcha diperlukan");
    }
    const captchaAnswerStr = String(captchaAnswer || "").trim();
    const captchaIdStr = String(captchaId || "").trim();
    if (captchaIdStr.length < 6 || captchaIdStr.length > 128 || captchaAnswerStr.length < 1 || captchaAnswerStr.length > 32) {
      return issueCaptchaChallenge(req, res, 400, "Captcha diperlukan");
    }
    const captchaOk = validateCaptcha(captchaIdStr, captchaAnswerStr);
    if (!captchaOk) {
      const count = bumpCounter(loginFailCounters, ip, 5 * 60 * 1000);
      if (count >= 8 && oncePerWindow(alertCooldown, `login-fail:${ip}`, 10 * 60 * 1000)) {
        await recordCliSecurityEvent(req, { type: "alert.login_failed_spike", message: "Login failed spike", meta: { count } });
      }
      return issueCaptchaChallenge(req, res, 400, "Captcha salah atau kadaluarsa");
    }

    await ensureCliSchema();
    await cleanupExpiredSessions();
    const user = await get(
      "SELECT id, username, telegram_id, is_admin, is_banned, balance, unique_code, password_hash FROM users WHERE unique_code = ?",
      [code],
    );
    if (!user) return issueCaptchaChallenge(req, res, 401, "Unique code atau password salah");
    if (user.is_banned) return res.status(403).json({ message: "Akun diblokir" });

    const ok = await bcrypt.compare(pass, user.password_hash || "");
    if (!ok) {
      const count = bumpCounter(loginFailCounters, ip, 5 * 60 * 1000);
      if (count >= 8 && oncePerWindow(alertCooldown, `login-fail:${ip}`, 10 * 60 * 1000)) {
        await recordCliSecurityEvent(req, { type: "alert.login_failed_spike", message: "Login failed spike", meta: { count } });
      }
      return issueCaptchaChallenge(req, res, 401, "Unique code atau password salah");
    }

    const now = Date.now();
    const sessionId = makeSessionId();
    const refreshToken = makeRefreshToken();
    await run(
      "INSERT INTO cli_sessions (id, user_id, refresh_token_hash, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
      [sessionId, user.id, hashToken(refreshToken), now, now + DAY_MS, now],
    );
    await pruneUserSessions(user.id, sessionId);
    const token = issueCliToken(sessionId);
    const plan = await getActiveUserPlan(user.id);

    return res.json({
      message: "Login CLI sukses",
      token,
      refreshToken,
      user: sanitizeUser(user, plan),
    });
  } catch (err) {
    console.error("CLI login error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.post("/session/refresh", requireJson, requireCliDbSlot, async (req, res) => {
  const refreshToken = validateRefreshToken(req.body?.refreshToken);
  if (!refreshToken) return res.status(400).json({ message: "refreshToken wajib diisi" });
  try {
    const ip = getClientIp(req);
    await maybeLogSuspiciousClient(req, null);
    const rlIp = rateLimitInfo(refreshRequests, ip, MAX_REFRESH_PER_WINDOW, REFRESH_WINDOW_MS);
    if (!rlIp.allowed) {
      res.set("Retry-After", String(rlIp.retryAfterSec));
      await recordCliSecurityEventOnce(
        req,
        { type: "rate_limit.refresh_ip", message: "Refresh rate limited (ip)", meta: { retryAfterSec: rlIp.retryAfterSec } },
        60 * 1000,
      );
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }
    await ensureCliSchema();
    await cleanupExpiredSessions();
    const session = await get(
      "SELECT id, user_id, created_at, expires_at FROM cli_sessions WHERE refresh_token_hash = ?",
      [hashToken(refreshToken)],
    );
    if (!session) {
      const count = bumpCounter(refreshFailCounters, ip, 5 * 60 * 1000);
      if (count >= 10 && oncePerWindow(alertCooldown, `refresh-fail:${ip}`, 10 * 60 * 1000)) {
        await recordCliSecurityEvent(req, { type: "alert.refresh_failed_spike", message: "Refresh failed spike", meta: { count } });
      }
      await recordCliSecurityEventOnce(req, { type: "refresh.invalid", message: "Invalid refresh token" });
      return res.status(401).json({ message: "Sesi tidak valid" });
    }
    if (session.expires_at <= Date.now()) {
      await run("DELETE FROM cli_sessions WHERE id = ?", [session.id]).catch(() => {});
      await recordCliSecurityEventOnce(
        req,
        { type: "refresh.expired", userId: session.user_id, message: "Refresh session expired" },
        10 * 60 * 1000,
      );
      return res.status(401).json({ message: "Sesi kadaluarsa" });
    }

    const rlUser = rateLimitInfo(refreshUserRequests, String(session.user_id), MAX_REFRESH_PER_USER_WINDOW, REFRESH_WINDOW_MS);
    if (!rlUser.allowed) {
      res.set("Retry-After", String(rlUser.retryAfterSec));
      await recordCliSecurityEventOnce(
        req,
        { type: "rate_limit.refresh_user", userId: session.user_id, message: "Refresh rate limited (user)", meta: { retryAfterSec: rlUser.retryAfterSec } },
        60 * 1000,
      );
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }

    const user = await get(
      "SELECT id, username, is_banned, balance, unique_code FROM users WHERE id = ?",
      [session.user_id],
    );
    if (!user) return res.status(404).json({ message: "User tidak ditemukan" });
    if (user.is_banned) return res.status(403).json({ message: "Akun diblokir" });

    const now = Date.now();
    const nextSessionId = makeSessionId();
    const nextRefresh = makeRefreshToken();
    await run(
      "UPDATE cli_sessions SET id = ?, refresh_token_hash = ?, last_seen = ? WHERE id = ?",
      [nextSessionId, hashToken(nextRefresh), now, session.id],
    );

    const token = issueCliToken(nextSessionId);
    const plan = await getActiveUserPlan(user.id);
    return res.json({
      message: "Sesi diperbarui",
      token,
      refreshToken: nextRefresh,
      user: sanitizeUser(user, plan),
    });
  } catch (err) {
    console.error("CLI refresh error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.get("/profile", requireCliDbSlot, async (req, res) => {
  try {
    await ensureCliSchema();
    await cleanupExpiredSessions();
    const session = await requireCliSession(req);
    const user = await get("SELECT id, username, is_banned, balance, unique_code FROM users WHERE id = ?", [
      session.user_id,
    ]);
    if (!user) return res.status(404).json({ message: "User tidak ditemukan" });
    if (user.is_banned) return res.status(403).json({ message: "Akun diblokir" });
    const plan = await getActiveUserPlan(user.id);
    return res.json({ user: sanitizeUser(user, plan) });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ message: err.message || "Token tidak valid" });
  }
});

router.post("/profile/password", requireJson, requireCliDbSlot, async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";
  const captchaId = req.body?.captchaId;
  const captchaAnswer = req.body?.captchaAnswer;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ message: "Semua field wajib diisi" });
  }
  if (newPassword.length < 10) {
    return res.status(400).json({ message: "Password baru minimal 10 karakter" });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: "Konfirmasi password tidak sama" });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ message: "Password baru tidak boleh sama dengan password lama" });
  }
  if (newPassword.length > 128 || currentPassword.length > 128 || confirmPassword.length > 128) {
    return res.status(400).json({ message: "Password terlalu panjang" });
  }

  try {
    await ensureCliSchema();
    await cleanupExpiredSessions();
    const session = await requireCliSession(req);

    const ip = getClientIp(req);
    if (!allowInWindow(passwordRequests, ip, MAX_PASSWORD_PER_WINDOW, PASSWORD_WINDOW_MS)) {
      return res.status(429).json({ message: "Terlalu banyak percobaan, coba lagi nanti" });
    }
    if (!allowInWindow(passwordUserRequests, String(session.user_id), MAX_PASSWORD_PER_USER_WINDOW, PASSWORD_WINDOW_MS)) {
      return res.status(429).json({ message: "Terlalu banyak percobaan, coba lagi nanti" });
    }

    if (!captchaId || typeof captchaAnswer !== "string") {
      return issueCaptchaChallenge(req, res, 400, "Captcha diperlukan");
    }
    const captchaAnswerStr = String(captchaAnswer || "").trim();
    const captchaIdStr = String(captchaId || "").trim();
    if (captchaIdStr.length < 6 || captchaIdStr.length > 128 || captchaAnswerStr.length < 1 || captchaAnswerStr.length > 32) {
      return issueCaptchaChallenge(req, res, 400, "Captcha diperlukan");
    }
    const captchaOk = validateCaptcha(captchaIdStr, captchaAnswerStr);
    if (!captchaOk) {
      return issueCaptchaChallenge(req, res, 400, "Captcha salah atau kadaluarsa");
    }

    const user = await get("SELECT id, password_hash, is_banned FROM users WHERE id = ?", [session.user_id]);
    if (!user) return res.status(404).json({ message: "User tidak ditemukan" });
    if (user.is_banned) return res.status(403).json({ message: "Akun diblokir" });

    const match = await bcrypt.compare(currentPassword, user.password_hash || "");
    if (!match) {
      const count = bumpCounter(loginFailCounters, ip, 10 * 60 * 1000);
      if (count >= 8 && oncePerWindow(alertCooldown, `pw-fail:${ip}`, 10 * 60 * 1000)) {
        await recordCliSecurityEvent(req, { type: "alert.password_failed_spike", userId: session.user_id, message: "Password change failed spike", meta: { count } });
      }
      return issueCaptchaChallenge(req, res, 401, "Password lama salah");
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    const now = Date.now();
    const nextSessionId = makeSessionId();
    const nextRefresh = makeRefreshToken();

    await withTransaction(async () => {
      // Invalidate web sessions
      await run("UPDATE users SET password_hash = ?, session_token = ?, session_last_seen = ? WHERE id = ?", [
        newHash,
        crypto.randomUUID(),
        now,
        user.id,
      ]);

      // Invalidate all existing CLI sessions and create a fresh one (so the caller stays logged in).
      await run("DELETE FROM cli_sessions WHERE user_id = ?", [user.id]);
      await run(
        "INSERT INTO cli_sessions (id, user_id, refresh_token_hash, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
        [nextSessionId, user.id, hashToken(nextRefresh), now, now + DAY_MS, now],
      );
    });

    const nextToken = issueCliToken(nextSessionId);
    const profile = await get("SELECT id, username, is_banned, balance, unique_code FROM users WHERE id = ?", [user.id]);
    const plan = await getActiveUserPlan(user.id);
    return res.json({
      message: "Password berhasil diperbarui",
      token: nextToken,
      refreshToken: nextRefresh,
      user: sanitizeUser(profile, plan),
    });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ message: err.message || "Token tidak valid" });
  }
});

router.get("/methods", requireCliDbSlot, async (req, res) => {
  try {
    await ensureCliSchema();
    await cleanupExpiredSessions();
    const session = await requireCliSession(req);
    const user = await get("SELECT id, is_admin, is_banned FROM users WHERE id = ?", [session.user_id]);
    if (!user) return res.status(404).json({ message: "User tidak ditemukan" });
    if (user.is_banned) return res.status(403).json({ message: "Akun diblokir" });

    const rows = await all("SELECT id, name, display_name, layer, tier, audience, description FROM methods ORDER BY id ASC");
    const list = [];
    for (const m of rows) {
      if (!user.is_admin && m.audience !== "all") continue;
      const params = await all(
        "SELECT id, param_key, label, type, required, placeholder, default_value, options FROM method_params WHERE method_id = ? ORDER BY id ASC",
        [m.id],
      );
      list.push(sanitizeMethodForCli(m, params));
    }
    return res.json({ methods: list });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ message: err.message || "Token tidak valid" });
  }
});

const cleanupExpiredPanelLogs = () => {
  const now = Date.now();
  return run("UPDATE attack_logs SET status = 'completed' WHERE status = 'running' AND end_at <= ?", [now]).catch(() => {});
};

const getPanelOngoingTasks = async () => {
  const rows = await all(
    `SELECT l.id, l.host, l.method_id, l.server_id, l.start_at, l.end_at, l.time, l.concurrent, l.status,
            m.display_name, m.name as method_name,
            s.name as server_name
     FROM attack_logs l
     JOIN methods m ON m.id = l.method_id
     JOIN servers s ON s.id = l.server_id
     WHERE l.status = 'running' AND l.end_at > ?
     ORDER BY l.start_at DESC`,
    [Date.now()],
  );
  return (rows || []).map((r) => ({
    id: r.id,
    host: r.host,
    methodName: r.method_name,
    displayName: r.display_name,
    serverName: r.server_name,
    endsAt: r.end_at,
    time: r.time,
    status: r.status,
    startAt: r.start_at,
    concurrent: r.concurrent ?? 1,
  }));
};

const getPanelScheduledTasks = async () => {
  const rows = await all(
    `SELECT s.id, s.host, s.method_id, s.time, s.concurrent, s.run_at,
            m.display_name, m.name as method_name
     FROM attack_schedules s
     JOIN methods m ON m.id = s.method_id
     WHERE s.status = 'pending' AND s.run_at > ?
     ORDER BY s.run_at ASC`,
    [Date.now()],
  );
  return (rows || []).map((r) => ({
    id: r.id,
    host: r.host,
    methodName: r.method_name,
    displayName: r.display_name,
    serverName: "-",
    endsAt: r.run_at + r.time * 1000,
    time: r.time,
    status: "scheduled",
    startAt: r.run_at,
    concurrent: r.concurrent ?? 1,
  }));
};

const sanitizePanelTask = (task) => ({
  id: task.id,
  host: sanitizeCliPlain(task.host, 220),
  methodName: sanitizeCliPlain(task.methodName, 64),
  displayName: sanitizeCliPlain(task.displayName, 120),
  serverName: sanitizeCliPlain(task.serverName, 80),
  endsAt: task.endsAt,
  time: task.time,
  status: task.status,
  startAt: task.startAt,
  concurrent: task.concurrent ?? 1,
});

const markPanelLogCompleted = (logId) =>
  run("UPDATE attack_logs SET status = 'completed' WHERE id = ?", [logId]).catch(() => {});

const getServerLoad = async (serverId) => {
  const row = await get(
    "SELECT COALESCE(SUM(concurrent), 0) AS load FROM attack_logs WHERE server_id = ? AND status = 'running' AND end_at > ?",
    [serverId, Date.now()],
  );
  return row?.load ? Number(row.load) : 0;
};

const getMethodWithParams = async (id) => {
  const method = await get(
    "SELECT id, name, display_name, layer, tier, audience, description FROM methods WHERE id = ?",
    [id],
  );
  if (!method) return null;
  const params = await all(
    "SELECT id, param_key, label, type, required, placeholder, default_value, options FROM method_params WHERE method_id = ? ORDER BY id ASC",
    [id],
  );
  return sanitizeMethodForCli(method, params);
};

const selectServersForMethod = async (methodId, layer, needed) => {
  const rows = await all(
    `SELECT s.id, s.name, s.api_url, s.max_concurrent, s.max_time, s.layer, s.status,
            s.success_check_enabled, s.success_key, s.success_value
     FROM servers s
     JOIN server_methods sm ON sm.server_id = s.id
     WHERE sm.method_id = ? AND s.layer = ? AND s.status = 'online'
     ORDER BY s.id ASC`,
    [methodId, layer],
  );
  if (!rows.length) return [];

  const enriched = [];
  for (const srv of rows) {
    const load = await getServerLoad(srv.id);
    const available = Math.max(Number(srv.max_concurrent || 0) - load, 0);
    if (available > 0) enriched.push({ ...srv, load, available });
  }
  enriched.sort((a, b) => a.load - b.load);

  let remaining = needed;
  const picks = [];
  for (const srv of enriched) {
    if (remaining <= 0) break;
    const take = Math.min(srv.available, remaining);
    if (take > 0) {
      picks.push({ ...srv, take });
      remaining -= take;
    }
  }
  return picks;
};

const parseCheckbox = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return false;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  return Boolean(value);
};

const startAttack = async (host, requestedTime, concurrentNum, methodRow, paramsMap = {}) => {
  const selectedServers = await selectServersForMethod(methodRow.id, methodRow.layer, concurrentNum);
  if (!selectedServers.length) {
    throw new Error("Tidak ada server tersedia untuk method ini");
  }
  const totalAvailable = selectedServers.reduce((sum, s) => sum + (s.take || 0), 0);
  if (totalAvailable < concurrentNum) {
    throw new Error(`Server penuh, tersedia ${totalAvailable} slot dari ${concurrentNum}`);
  }

  const maxTimeLimit = Math.min(...selectedServers.map((s) => Number(s.max_time || 0) || requestedTime));
  const finalTime = Math.min(requestedTime, maxTimeLimit || requestedTime);
  const tasks = [];
  const failures = [];
  const now = Date.now();

  const replaceToken = (tpl, key, value) => String(tpl || "").replace(new RegExp(`\\[${escapeRegExp(key)}\\]`, "g"), value);
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
    const take = Number(srv.take || 0) || 0;
    const endsAt = now + finalTime * 1000;
    let url = replaceToken(
      replaceToken(replaceToken(srv.api_url, "host", encodeURIComponent(String(host).trim())), "time", String(finalTime)),
      "method",
      encodeURIComponent(methodRow.name),
    );
    for (const [k, v] of Object.entries(paramsMap || {})) {
      url = replaceToken(url, k, encodeURIComponent(String(v)));
    }
    for (let i = 0; i < take; i++) {
      const taskId = crypto.randomUUID();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        timer.unref?.();
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        const body = await resp.text().catch(() => "");
        const success = checkResponse(srv, resp.status, body);
        if (!success) {
          failures.push({ server: srv.name, status: resp.status });
          continue;
        }

        const task = {
          id: taskId,
          host: String(host).trim(),
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
          [taskId, String(host).trim(), methodRow.id, srv.id, now, endsAt, finalTime, 1, new Date().toISOString()],
        );
        const timer2 = setTimeout(() => markPanelLogCompleted(taskId), finalTime * 1000);
        timer2.unref?.();
      } catch (err) {
        failures.push({ server: srv.name, status: "fetch_error" });
        console.error("[CLI RUN ERROR]", { url, server: srv.name, method: methodRow.name, error: err?.message || String(err) });
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

router.get("/panel/ongoing", requireCliDbSlot, async (req, res) => {
  try {
    await ensureCliSchema();
    await cleanupExpiredSessions();
    const session = await requireCliSession(req);
    const user = await get("SELECT id, is_banned FROM users WHERE id = ?", [session.user_id]);
    if (!user) return res.status(404).json({ message: "User tidak ditemukan" });
    if (user.is_banned) return res.status(403).json({ message: "Akun diblokir" });

    await cleanupExpiredPanelLogs();
    const [scheduled, running, plan] = await Promise.all([
      getPanelScheduledTasks(),
      getPanelOngoingTasks(),
      getActiveUserPlan(session.user_id),
    ]);
    const maxConcurrent = plan?.maxConcurrent ?? null;
    return res.json({ tasks: [...scheduled, ...running], maxConcurrent });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ message: err.message || "Token tidak valid" });
  }
});

router.post("/panel/run", requireJson, requireCliDbSlot, async (req, res) => {
  const host = normalizeHostInput(req.body?.host);
  const methodNum = Number(req.body?.methodId);
  const requestedTime = Number(req.body?.time);
  const concurrentNum = Number(req.body?.concurrent ?? 1);
  const scheduledAt = req.body?.scheduledAt;

  if (!host || host.length < 3) return res.status(400).json({ message: "Host tidak valid" });
  if (!Number.isInteger(methodNum)) return res.status(400).json({ message: "Method tidak valid" });
  if (!Number.isInteger(requestedTime) || requestedTime < 1 || requestedTime > 86400) {
    return res.status(400).json({ message: "Time 1-86400 detik" });
  }
  if (!Number.isInteger(concurrentNum) || concurrentNum < 1 || concurrentNum > 1000) {
    return res.status(400).json({ message: "Concurrent 1-1000" });
  }

  try {
    await ensureCliSchema();
    await cleanupExpiredSessions();
    const session = await requireCliSession(req);
    const ip = getClientIp(req);
    if (!allowInWindow(runRequests, ip, MAX_RUN_PER_WINDOW, RUN_WINDOW_MS)) {
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }
    if (!allowInWindow(runUserRequests, String(session.user_id), MAX_RUN_PER_USER_WINDOW, RUN_WINDOW_MS)) {
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }
    if (!allowInWindow(runIpUserRequests, `${ip}:${session.user_id}`, MAX_RUN_PER_USER_WINDOW, RUN_WINDOW_MS)) {
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }

    const user = await get("SELECT id, is_admin, is_banned FROM users WHERE id = ?", [session.user_id]);
    if (!user) return res.status(404).json({ message: "User tidak ditemukan" });
    if (user.is_banned) return res.status(403).json({ message: "Akun diblokir" });

    await cleanupExpiredPanelLogs();
    const activePlan = await getActiveUserPlan(session.user_id);
    if (!activePlan) return res.status(403).json({ message: "Plan diperlukan" });

    const methodRow = await getMethodWithParams(methodNum);
    if (!methodRow) return res.status(404).json({ message: "Method tidak ditemukan" });
    if (methodRow.audience === "admin" && !user.is_admin) {
      return res.status(403).json({ message: "Method khusus admin" });
    }
    if (methodRow.tier === "premium" && !activePlan.premiumAccess) {
      return res.status(403).json({ message: "Plan tidak mengizinkan method premium" });
    }

    const inputParams = req.body?.params && typeof req.body.params === "object" && !Array.isArray(req.body.params) ? req.body.params : {};
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
        val = parseCheckbox(val);
      } else if (p.type === "select" && p.options) {
        const opts = String(p.options || "")
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean);
        if (opts.length && !opts.includes(String(val))) {
          return res.status(400).json({ message: `Parameter ${key} tidak valid` });
        }
        val = String(val);
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
      const totalCap = servers.reduce((sum, s) => sum + (s.take || 0), 0);
      if (totalCap < cappedConcurrent) {
        return res.status(503).json({ message: `Server penuh, tersedia ${totalCap} slot dari ${cappedConcurrent}` });
      }
      const scheduleId = crypto.randomUUID();
      const cappedTime = Math.min(requestedTime, activePlan.maxTime);
      await run(
        "INSERT INTO attack_schedules (id, host, method_id, time, concurrent, run_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
        [scheduleId, host.trim(), methodRow.id, cappedTime, cappedConcurrent, runAt, new Date().toISOString()],
      );
      return res.json({
        message: "Dijadwalkan",
        tasks: [
          sanitizePanelTask({
            id: scheduleId,
            host: host.trim(),
            methodName: methodRow.name,
            displayName: methodRow.display_name,
            serverName: "-",
            endsAt: runAt + cappedTime * 1000,
            time: cappedTime,
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
    return res.json({ message: "Dikirim", tasks: tasks.map((t) => sanitizePanelTask(t)) });
  } catch (err) {
    const status = err?.status || (err?.code === 502 ? 502 : 500);
    if (status !== 401) console.error("[CLI RUN ERROR]", err);
    return res.status(status).json({ message: err?.message || (status === 401 ? "Token tidak valid" : "Terjadi kesalahan server") });
  }
});

router.post("/panel/stop", requireJson, requireCliDbSlot, async (req, res) => {
  const taskId = trimStr(req.body?.taskId, 128).trim();
  if (!taskId) return res.status(400).json({ message: "ID tidak valid" });
  try {
    await ensureCliSchema();
    await cleanupExpiredSessions();
    const session = await requireCliSession(req);
    const ip = getClientIp(req);
    if (!allowInWindow(stopRequests, ip, MAX_STOP_PER_WINDOW, STOP_WINDOW_MS)) {
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }
    if (!allowInWindow(stopUserRequests, String(session.user_id), MAX_STOP_PER_USER_WINDOW, STOP_WINDOW_MS)) {
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }
    if (!allowInWindow(stopIpUserRequests, `${ip}:${session.user_id}`, MAX_STOP_PER_USER_WINDOW, STOP_WINDOW_MS)) {
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }

    const user = await get("SELECT id, is_banned FROM users WHERE id = ?", [session.user_id]);
    if (!user) return res.status(404).json({ message: "User tidak ditemukan" });
    if (user.is_banned) return res.status(403).json({ message: "Akun diblokir" });

    await cleanupExpiredPanelLogs();
    const log = await get(
      `SELECT l.id, l.host, l.server_id, l.method_id, l.status, s.api_url, s.name AS server_name, m.name AS method_name
       FROM attack_logs l
       JOIN servers s ON s.id = l.server_id
       JOIN methods m ON m.id = l.method_id
       WHERE l.id = ? AND l.status = 'running'`,
      [taskId],
    );
    if (!log) return res.status(404).json({ message: "Task tidak ditemukan" });

    const url = String(log.api_url || "")
      .replace(/\[host\]/g, encodeURIComponent(String(log.host || "")))
      .replace(/\[time\]/g, "0")
      .replace(/\[method\]/g, "STOP");

    if (/^https?:\/\//i.test(url)) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        timer.unref?.();
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        const body = await resp.text().catch(() => "");
        console.log("[CLI STOP]", {
          url,
          status: resp.status,
          server: log.server_name,
          method: log.method_name,
          body: String(body).slice(0, 200),
        });
      } catch (err) {
        console.error("[CLI STOP ERROR]", {
          url,
          server: log.server_name,
          error: err?.message || String(err),
        });
      }
    }

    await run("UPDATE attack_logs SET status = 'completed' WHERE id = ?", [taskId]);
    return res.json({ message: "Dihentikan" });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ message: err.message || "Token tidak valid" });
  }
});

const normalizeWhitelistInput = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(",");
  return [];
};

const parseWhitelist = (value) => {
  const raw = normalizeWhitelistInput(value)
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  if (!raw.length) return [];
  const invalid = raw.filter((ip) => net.isIP(ip) === 0);
  if (invalid.length) {
    const err = new Error("Whitelist IP tidak valid");
    err.status = 400;
    err.details = invalid.slice(0, 3);
    throw err;
  }
  return [...new Set(raw)].slice(0, 3);
};

router.get("/manager/key", requireCliDbSlot, async (req, res) => {
  try {
    await ensureCliSchema();
    await cleanupExpiredSessions();
    const session = await requireCliSession(req);
    const row = await get(
      "SELECT api_key, created_at, active, logging_enabled, auto_bind, bound_ip, whitelist_ips FROM api_keys WHERE user_id = ?",
      [session.user_id],
    );
    if (!row) {
      return res.json({
        apiKey: null,
        createdAt: null,
        active: true,
        loggingEnabled: true,
        autoBind: false,
        boundIp: null,
        whitelist: [],
      });
    }
    return res.json({
      apiKey: row.api_key,
      createdAt: row.created_at,
      active: !!row.active,
      loggingEnabled: !!row.logging_enabled,
      autoBind: !!row.auto_bind,
      boundIp: row.bound_ip,
      whitelist: row.whitelist_ips ? String(row.whitelist_ips).split(",").map((x) => x.trim()).filter(Boolean) : [],
    });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ message: err.message || "Token tidak valid" });
  }
});

router.post("/manager/key", requireJson, requireCliDbSlot, async (req, res) => {
  try {
    await ensureCliSchema();
    await cleanupExpiredSessions();
    const session = await requireCliSession(req);
    const ip = getClientIp(req);
    const rlIp = rateLimitInfo(apiKeyGenRequests, ip, MAX_APIKEY_GEN_PER_WINDOW, APIKEY_GEN_WINDOW_MS);
    if (!rlIp.allowed) {
      res.set("Retry-After", String(rlIp.retryAfterSec));
      await recordCliSecurityEventOnce(
        req,
        { type: "rate_limit.apikey_generate_ip", userId: session.user_id, message: "API key generate rate limited (ip)", meta: { retryAfterSec: rlIp.retryAfterSec } },
        60 * 1000,
      );
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }
    const rlUser = rateLimitInfo(apiKeyGenUserRequests, String(session.user_id), MAX_APIKEY_GEN_PER_USER_WINDOW, APIKEY_GEN_WINDOW_MS);
    if (!rlUser.allowed) {
      res.set("Retry-After", String(rlUser.retryAfterSec));
      await recordCliSecurityEventOnce(
        req,
        { type: "rate_limit.apikey_generate_user", userId: session.user_id, message: "API key generate rate limited (user)", meta: { retryAfterSec: rlUser.retryAfterSec } },
        60 * 1000,
      );
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }
    const plan = await getActiveUserPlan(session.user_id);
    if (!plan) return res.status(403).json({ message: "Plan aktif diperlukan untuk membuat API key" });
    if (!plan.apiAccess) return res.status(403).json({ message: "Plan tidak mengizinkan akses API" });

    const autoBind = req.body?.autoBind === true;
    const whitelist = parseWhitelist(req.body?.whitelist);
    let apiKey = null;
    const now = new Date().toISOString();

    await withTransaction(async () => {
      await run("DELETE FROM api_keys WHERE user_id = ?", [session.user_id]);
      for (let i = 0; i < 8; i++) {
        const candidate = makeApiKey();
        const exists = await get("SELECT 1 FROM api_keys WHERE api_key = ? LIMIT 1", [candidate]);
        if (!exists) {
          apiKey = candidate;
          break;
        }
      }
      if (!apiKey) throw new Error("Gagal membuat API key, coba lagi.");
      await run(
        "INSERT INTO api_keys (user_id, api_key, created_at, active, logging_enabled, auto_bind, bound_ip, whitelist_ips) VALUES (?, ?, ?, 1, 1, ?, NULL, ?)",
        [session.user_id, apiKey, now, autoBind ? 1 : 0, whitelist.length ? whitelist.join(",") : null],
      );
    });

    return res.json({
      apiKey,
      createdAt: now,
      active: true,
      loggingEnabled: true,
      autoBind,
      boundIp: null,
      whitelist,
    });
  } catch (err) {
    if (err?.status && err.status < 500) {
      return res.status(err.status).json({ message: err.message || "Permintaan tidak valid", details: err.details });
    }
    console.error("CLI generate api key error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.patch("/manager/key/settings", requireJson, requireCliDbSlot, async (req, res) => {
  try {
    await ensureCliSchema();
    await cleanupExpiredSessions();
    const session = await requireCliSession(req);
    const hasKey = await get("SELECT api_key FROM api_keys WHERE user_id = ?", [session.user_id]);
    if (!hasKey) return res.status(404).json({ message: "Belum ada API key" });

    const rlUser = rateLimitInfo(apiKeySettingsUserRequests, String(session.user_id), MAX_APIKEY_SETTINGS_PER_USER_WINDOW, APIKEY_SETTINGS_WINDOW_MS);
    if (!rlUser.allowed) {
      res.set("Retry-After", String(rlUser.retryAfterSec));
      await recordCliSecurityEventOnce(
        req,
        { type: "rate_limit.apikey_settings_user", userId: session.user_id, message: "API key settings rate limited (user)", meta: { retryAfterSec: rlUser.retryAfterSec } },
        60 * 1000,
      );
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }
    const ip = getClientIp(req);
    const rlIpUser = rateLimitInfo(
      apiKeySettingsIpUserRequests,
      `${ip}:${session.user_id}`,
      MAX_APIKEY_SETTINGS_PER_USER_WINDOW,
      APIKEY_SETTINGS_WINDOW_MS,
    );
    if (!rlIpUser.allowed) {
      res.set("Retry-After", String(rlIpUser.retryAfterSec));
      await recordCliSecurityEventOnce(
        req,
        { type: "rate_limit.apikey_settings_ip_user", userId: session.user_id, message: "API key settings rate limited (ip+user)", meta: { retryAfterSec: rlIpUser.retryAfterSec } },
        60 * 1000,
      );
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }

    const { active, loggingEnabled, autoBind } = req.body || {};
    const whitelistProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "whitelist");
    const fields = [];
    const params = [];
    if (active !== undefined) {
      if (typeof active !== "boolean") return res.status(400).json({ message: "active harus boolean" });
      fields.push("active = ?");
      params.push(active ? 1 : 0);
    }
    if (loggingEnabled !== undefined) {
      if (typeof loggingEnabled !== "boolean") return res.status(400).json({ message: "loggingEnabled harus boolean" });
      fields.push("logging_enabled = ?");
      params.push(loggingEnabled ? 1 : 0);
    }
    if (autoBind !== undefined) {
      if (typeof autoBind !== "boolean") return res.status(400).json({ message: "autoBind harus boolean" });
      fields.push("auto_bind = ?");
      params.push(autoBind ? 1 : 0);
      if (!autoBind) fields.push("bound_ip = NULL");
    }
    if (whitelistProvided) {
      const wl = parseWhitelist(req.body?.whitelist);
      fields.push("whitelist_ips = ?");
      params.push(wl.length ? wl.join(",") : null);
    }
    if (!fields.length) return res.json({ message: "Disimpan" });

    params.push(session.user_id);
    await run(`UPDATE api_keys SET ${fields.join(", ")} WHERE user_id = ?`, params);
    return res.json({ message: "Disimpan" });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ message: err.message || "Token tidak valid" });
  }
});

router.get("/news", requireCliDbSlot, async (req, res) => {
  try {
    await ensureCliSchema();
    await cleanupExpiredSessions();
    await requireCliSession(req);
    const rows = await all("SELECT id, title, content, created_at FROM news ORDER BY id DESC LIMIT 1");
    return res.json({
      news: (rows || []).map((n) => ({
        id: n.id,
        title: n.title,
        content: n.content,
        createdAt: n.created_at,
      })),
    });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ message: err.message || "Token tidak valid" });
  }
});

router.post("/store/buy", requireJson, requireCliDbSlot, async (req, res) => {
  const planNum = Number(req.body?.planId);
  if (!Number.isInteger(planNum) || planNum <= 0) return res.status(400).json({ message: "Plan tidak valid" });
  try {
    await ensureCliSchema();
    await cleanupExpiredSessions();
    const session = await requireCliSession(req);
    const ip = getClientIp(req);
    if (!allowInWindow(storeBuyRequests, ip, MAX_STORE_BUY_PER_WINDOW, STORE_WINDOW_MS)) {
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }
    if (!allowInWindow(storeBuyUserRequests, String(session.user_id), MAX_STORE_BUY_PER_WINDOW, STORE_WINDOW_MS)) {
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }
    if (!allowInWindow(storeBuyIpUserRequests, `${ip}:${session.user_id}`, MAX_STORE_BUY_PER_WINDOW, STORE_WINDOW_MS)) {
      return res.status(429).json({ message: "Terlalu banyak request, coba lagi nanti" });
    }

    const user = await get("SELECT id, is_banned, balance, username, unique_code FROM users WHERE id = ?", [
      session.user_id,
    ]);
    if (!user) return res.status(404).json({ message: "User tidak ditemukan" });
    if (user.is_banned) return res.status(403).json({ message: "Akun diblokir" });

    const active = await getActiveUserPlan(user.id);
    if (active && active.id === planNum) {
      return res.status(400).json({ message: "Plan ini sudah aktif. Silakan upgrade ke plan lain." });
    }

    await withTransaction(async () => {
      const plan = await get(
        "SELECT id, name, price, discount, stock, duration_days, is_private, api_access, premium_access, max_concurrent, max_time, display_html FROM plans WHERE id = ?",
        [planNum],
      );
      if (!plan) throw new Error("PLAN_NOT_FOUND");
      if (plan.is_private) throw new Error("PLAN_PRIVATE");
      const finalPrice = Math.max(0, plan.price - Math.floor((plan.price * (plan.discount || 0)) / 100));

      const stockRes = await run("UPDATE plans SET stock = stock - 1 WHERE id = ? AND stock > 0", [plan.id]);
      if (stockRes.changes === 0) throw new Error("OUT_OF_STOCK");

      const debitRes = await run("UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?", [
        finalPrice,
        user.id,
        finalPrice,
      ]);
      if (debitRes.changes === 0) throw new Error("INSUFFICIENT");

      const expiresAt = plan.duration_days ? Date.now() + plan.duration_days * 24 * 60 * 60 * 1000 : null;
      await run(
        "INSERT OR REPLACE INTO user_plans (user_id, plan_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        [user.id, plan.id, expiresAt, new Date().toISOString()],
      );
      await logBalanceActivity(user.id, "spend", finalPrice, `buy-plan:${plan.id}`, null);
    });

    const updatedUser = await get("SELECT id, username, is_banned, balance, unique_code FROM users WHERE id = ?", [
      session.user_id,
    ]);
    const updatedPlan = await getActiveUserPlan(session.user_id);
    return res.json({
      message: "Plan dibeli",
      user: sanitizeUser(updatedUser, updatedPlan),
      plan: updatedPlan ? planSummary(updatedPlan) : null,
    });
  } catch (err) {
    if (err.message === "PLAN_NOT_FOUND") return res.status(404).json({ message: "Plan tidak ditemukan" });
    if (err.message === "PLAN_PRIVATE") return res.status(404).json({ message: "Plan tidak tersedia" });
    if (err.message === "OUT_OF_STOCK") return res.status(400).json({ message: "Stok habis" });
    if (err.message === "INSUFFICIENT") return res.status(400).json({ message: "Saldo tidak cukup" });
    const status = err.status || 500;
    if (status < 500) return res.status(status).json({ message: err.message || "Permintaan tidak valid" });
    console.error("CLI buy plan error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.post("/logout", requireJson, requireCliDbSlot, async (req, res) => {
  const rawRefreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken : "";
  const refreshToken = rawRefreshToken ? validateRefreshToken(rawRefreshToken) : null;
  if (rawRefreshToken && !refreshToken) return res.status(400).json({ message: "refreshToken tidak valid" });
  try {
    await ensureCliSchema();
    if (refreshToken) {
      await run("DELETE FROM cli_sessions WHERE refresh_token_hash = ?", [hashToken(refreshToken)]);
      return res.json({ message: "Logout sukses" });
    }
    const raw = extractBearer(req);
    if (!raw) return res.json({ message: "Logout sukses" });
    let payload = null;
    try {
      payload = jwt.verify(raw, JWT_SECRET, { algorithms: ["HS256"] });
    } catch {
      payload = null;
    }
    if (payload?.typ === "cli" && payload?.sid) {
      await run("DELETE FROM cli_sessions WHERE id = ?", [payload.sid]).catch(() => {});
    }
    return res.json({ message: "Logout sukses" });
  } catch (err) {
    console.error("CLI logout error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

const pruneTimestampArrayMap = (map, maxAgeMs, maxScan = 20000) => {
  const now = Date.now();
  if (map.size > 100000) {
    map.clear();
    return;
  }
  let scanned = 0;
  for (const [key, value] of map.entries()) {
    if (scanned++ >= maxScan) break;
    const arr = Array.isArray(value) ? value : [];
    const last = arr.length ? arr[arr.length - 1] : 0;
    if (!last || now - last > maxAgeMs) map.delete(key);
  }
};

const pruneNumberMap = (map, maxAgeMs, maxScan = 20000) => {
  const now = Date.now();
  if (map.size > 100000) {
    map.clear();
    return;
  }
  let scanned = 0;
  for (const [key, value] of map.entries()) {
    if (scanned++ >= maxScan) break;
    const ts = typeof value === "number" ? value : 0;
    if (!ts || now - ts > maxAgeMs) map.delete(key);
  }
};

const pruneCooldownMap = (map, maxScan = 20000) => {
  const now = Date.now();
  if (map.size > 100000) {
    map.clear();
    return;
  }
  let scanned = 0;
  for (const [key, value] of map.entries()) {
    if (scanned++ >= maxScan) break;
    const until = typeof value === "number" ? value : 0;
    if (!until || until <= now) map.delete(key);
  }
};

const pruneCliMaps = () => {
  const maxAge = 2 * DAY_MS;
  pruneTimestampArrayMap(captchaRequests, CAPTCHA_WINDOW_MS + CAPTCHA_COOLDOWN_MS + 60 * 1000);
  pruneTimestampArrayMap(loginRequests, maxAge);
  pruneTimestampArrayMap(loginCodeRequests, maxAge);
  pruneTimestampArrayMap(passwordRequests, maxAge);
  pruneTimestampArrayMap(passwordUserRequests, maxAge);
  pruneTimestampArrayMap(storeBuyRequests, maxAge);
  pruneTimestampArrayMap(storeBuyUserRequests, maxAge);
  pruneTimestampArrayMap(storeBuyIpUserRequests, maxAge);
  pruneTimestampArrayMap(refreshRequests, maxAge);
  pruneTimestampArrayMap(refreshUserRequests, maxAge);
  pruneTimestampArrayMap(apiKeyGenRequests, maxAge);
  pruneTimestampArrayMap(apiKeyGenUserRequests, maxAge);
  pruneTimestampArrayMap(apiKeySettingsUserRequests, maxAge);
  pruneTimestampArrayMap(apiKeySettingsIpUserRequests, maxAge);

  pruneTimestampArrayMap(loginFailCounters, 60 * 60 * 1000);
  pruneTimestampArrayMap(tokenInvalidCounters, 60 * 60 * 1000);
  pruneTimestampArrayMap(refreshFailCounters, 60 * 60 * 1000);

  pruneNumberMap(alertCooldown, 2 * DAY_MS);
  pruneCooldownMap(captchaCooldown);
};

setInterval(pruneCliMaps, MAP_PRUNE_INTERVAL_MS).unref?.();

const cleanupCliSecurityEvents = async () => {
  try {
    await ensureCliSchema();
    await ensureCliSecuritySchema();
    await run("DELETE FROM cli_security_events WHERE created_at <= ?", [Date.now() - SECURITY_EVENTS_RETENTION_MS]);
  } catch {
    // best-effort
  }
};

setInterval(() => {
  void cleanupCliSecurityEvents();
}, 6 * 60 * 60 * 1000).unref?.();

module.exports = router;

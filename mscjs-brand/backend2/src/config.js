const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const PORT = Number(process.env.PORT) || 4000;
const JWT_SECRET = process.env.JWT_SECRET;
const baseDir = path.join(__dirname, "..");
const rawDbPath = process.env.DB_PATH || path.join(baseDir, "data.sqlite");
const DB_PATH = path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(baseDir, rawDbPath);
const rawOrigins = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "").split(",");
const parsedOrigins = rawOrigins.map((o) => o.trim()).filter(Boolean);
const CORS_ALLOW_ALL = parsedOrigins.includes("*") || parsedOrigins.length === 0;
const CORS_ORIGINS = CORS_ALLOW_ALL ? [] : parsedOrigins;
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "session_token";
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || "").toLowerCase() === "true";
const RAW_SAMESITE = String(process.env.COOKIE_SAMESITE || "lax").toLowerCase();
const COOKIE_SAMESITE = ["lax", "strict", "none"].includes(RAW_SAMESITE) ? RAW_SAMESITE : "lax";
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 jam untuk sesi (sinkron dengan token CLI)

module.exports = {
  PORT,
  JWT_SECRET,
  DB_PATH,
  CORS_ORIGINS,
  CORS_ALLOW_ALL,
  SESSION_COOKIE_NAME,
  COOKIE_SECURE,
  COOKIE_SAMESITE,
  SESSION_MAX_AGE_MS,
};

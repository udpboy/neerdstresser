const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
const { DB_PATH } = require("./config");

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      telegram_id TEXT,
      is_admin INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      session_token TEXT,
      session_last_seen INTEGER DEFAULT 0,
      balance INTEGER DEFAULT 0
    )`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      author_id INTEGER,
      FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      layer TEXT NOT NULL CHECK(layer IN ('L4','L7')),
      tier TEXT NOT NULL CHECK(tier IN ('basic','premium')),
      audience TEXT NOT NULL CHECK(audience IN ('all','admin')),
      description TEXT DEFAULT 'test',
      created_at TEXT NOT NULL
    )`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      api_url TEXT NOT NULL,
      max_concurrent INTEGER NOT NULL,
      max_time INTEGER NOT NULL,
      layer TEXT NOT NULL CHECK(layer IN ('L4','L7')),
      status TEXT NOT NULL CHECK(status IN ('online','offline','maintenance')),
      success_check_enabled INTEGER NOT NULL DEFAULT 0,
      success_key TEXT,
      success_value TEXT,
      created_at TEXT NOT NULL
    )`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS server_methods (
      server_id INTEGER NOT NULL,
      method_id INTEGER NOT NULL,
      PRIMARY KEY(server_id, method_id),
      FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY(method_id) REFERENCES methods(id) ON DELETE CASCADE
    )`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS attack_logs (
      id TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      method_id INTEGER NOT NULL,
      server_id INTEGER NOT NULL,
      start_at INTEGER NOT NULL,
      end_at INTEGER NOT NULL,
      time INTEGER NOT NULL,
      concurrent INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK(status IN ('running','completed')),
      created_at TEXT NOT NULL,
      FOREIGN KEY(method_id) REFERENCES methods(id) ON DELETE CASCADE,
      FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
    )`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS attack_schedules (
      id TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      method_id INTEGER NOT NULL,
      time INTEGER NOT NULL,
      concurrent INTEGER NOT NULL DEFAULT 1,
      run_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','failed','executed')),
      created_at TEXT NOT NULL,
      FOREIGN KEY(method_id) REFERENCES methods(id) ON DELETE CASCADE
    )`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS method_params (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method_id INTEGER NOT NULL,
      param_key TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('text','number','select','checkbox')),
      required INTEGER NOT NULL DEFAULT 0,
      placeholder TEXT,
      default_value TEXT,
      options TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(method_id) REFERENCES methods(id) ON DELETE CASCADE
    )`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      display_html TEXT NOT NULL,
      max_concurrent INTEGER NOT NULL DEFAULT 1,
      max_time INTEGER NOT NULL DEFAULT 60,
      price INTEGER NOT NULL DEFAULT 0,
      discount INTEGER NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      api_access INTEGER NOT NULL DEFAULT 0,
      premium_access INTEGER NOT NULL DEFAULT 0,
      duration_days INTEGER,
      is_private INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS user_plans (
      user_id INTEGER PRIMARY KEY,
      plan_id INTEGER NOT NULL,
      expires_at INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE SET NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS balance_topups (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      admin_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(admin_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS balance_logs (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      admin_id INTEGER,
      type TEXT NOT NULL CHECK(type IN ('topup','spend')),
      amount INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(admin_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS api_keys (
      user_id INTEGER PRIMARY KEY,
      api_key TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      logging_enabled INTEGER NOT NULL DEFAULT 1,
      auto_bind INTEGER NOT NULL DEFAULT 0,
      bound_ip TEXT,
      whitelist_ips TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS api_requests (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      host TEXT NOT NULL,
      method_id INTEGER NOT NULL,
      time INTEGER NOT NULL,
      concurrent INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(method_id) REFERENCES methods(id) ON DELETE CASCADE
    )`,
  );
  db.run("UPDATE methods SET description = 'test' WHERE description IS NULL OR description = ''");
});

const ensureApiKeyColumns = () =>
  new Promise((resolve) => {
    db.all("PRAGMA table_info(api_keys)", [], (err, rows) => {
      if (err) return resolve();
      const names = rows.map((r) => r.name);
      const ops = [];
      if (!names.includes("active")) ops.push("ALTER TABLE api_keys ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
      if (!names.includes("logging_enabled")) ops.push("ALTER TABLE api_keys ADD COLUMN logging_enabled INTEGER NOT NULL DEFAULT 1");
      if (!names.includes("auto_bind")) ops.push("ALTER TABLE api_keys ADD COLUMN auto_bind INTEGER NOT NULL DEFAULT 0");
      if (!names.includes("bound_ip")) ops.push("ALTER TABLE api_keys ADD COLUMN bound_ip TEXT");
      if (!names.includes("whitelist_ips")) ops.push("ALTER TABLE api_keys ADD COLUMN whitelist_ips TEXT");
      const runOps = ops.reduce(
        (p, sql) =>
          p.then(
            () =>
              new Promise((resolve2) => {
                db.run(sql, [], () => resolve2());
              }),
          ),
        Promise.resolve(),
      );
      runOps.then(() => resolve());
    });
  });
ensureApiKeyColumns();

const ensureServerSuccessColumns = () =>
  new Promise((resolve) => {
    db.all("PRAGMA table_info(servers)", [], (err, rows) => {
      if (err) return resolve();
      const names = rows.map((r) => r.name);
      const ops = [];
      if (!names.includes("success_check_enabled")) {
        ops.push("ALTER TABLE servers ADD COLUMN success_check_enabled INTEGER NOT NULL DEFAULT 0");
      }
      if (!names.includes("success_key")) {
        ops.push("ALTER TABLE servers ADD COLUMN success_key TEXT");
      }
      if (!names.includes("success_value")) {
        ops.push("ALTER TABLE servers ADD COLUMN success_value TEXT");
      }
      const runOps = ops.reduce(
        (p, sql) =>
          p.then(
            () =>
              new Promise((resolve2) => {
                db.run(sql, [], () => resolve2());
              }),
          ),
        Promise.resolve(),
      );
      runOps.then(() => resolve());
    });
  });
ensureServerSuccessColumns();

const ensurePlanPrivateColumn = () =>
  new Promise((resolve) => {
    db.all("PRAGMA table_info(plans)", [], (err, rows) => {
      if (err) return resolve();
      const names = rows.map((r) => r.name);
      if (names.includes("is_private")) return resolve();
      db.run("ALTER TABLE plans ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0", [], () => resolve());
    });
  });
ensurePlanPrivateColumn();

const ensureSessionTokensFilled = () =>
  new Promise((resolve) => {
    db.run("UPDATE users SET session_token = hex(randomblob(16)) WHERE session_token IS NULL", [], () => resolve());
  });
ensureSessionTokensFilled();

const generateUserCode = () =>
  new Promise((resolve) => {
    const attempt = () => {
      const code = `U-${crypto.randomBytes(5).toString("hex")}`;
      db.get("SELECT id FROM users WHERE unique_code = ?", [code], (err, row) => {
        if (err) return resolve(code);
        if (row) return attempt();
        return resolve(code);
      });
    };
    attempt();
  });

const ensureUserUniqueCode = () =>
  new Promise((resolve) => {
    db.all("PRAGMA table_info(users)", [], (err, rows) => {
      if (err) return resolve();
      const names = rows.map((r) => r.name);
      const addColumn = names.includes("unique_code")
        ? (cb) => cb()
        : (cb) => {
            db.run("ALTER TABLE users ADD COLUMN unique_code TEXT", [], (_e) => cb());
          };
      addColumn(() => {
        db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unique_code ON users(unique_code)", [], () => {
          db.all("SELECT id FROM users WHERE unique_code IS NULL OR unique_code = ''", [], async (_err2, rows2) => {
            if (!rows2 || rows2.length === 0) return resolve();
            for (const row of rows2) {
              const code = await generateUserCode();
              await new Promise((res3) => db.run("UPDATE users SET unique_code = ? WHERE id = ?", [code, row.id], () => res3()));
            }
            resolve();
          });
        });
      });
    });
  });
ensureUserUniqueCode();

const ensureReady = () =>
  ensureUserUniqueCode().catch(() => {});

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function runCallback(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

const withTransaction = async (fn) => {
  await run("BEGIN IMMEDIATE");
  try {
    const res = await fn();
    await run("COMMIT");
    return res;
  } catch (err) {
    await run("ROLLBACK").catch(() => {});
    throw err;
  }
};

module.exports = {
  db,
  run,
  get,
  all,
  withTransaction,
  ensureUserUniqueCode,
  ensureReady,
};

const { run } = require("../db");
const crypto = require("crypto");

const logBalanceActivity = async (userId, type, amount, note = "", adminId = null) => {
  const id = crypto.randomUUID();
  const safeNote = note ? String(note).slice(0, 200) : null;
  const now = new Date().toISOString();
  await run(
    "INSERT INTO balance_logs (id, user_id, admin_id, type, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, userId, adminId, type, amount, safeNote, now],
  );
};

module.exports = { logBalanceActivity };

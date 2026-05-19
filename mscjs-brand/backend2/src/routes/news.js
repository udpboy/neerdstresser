const express = require("express");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { db, run } = require("../db");

const router = express.Router();

router.get("/news", async (_req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all("SELECT id, title, content, created_at FROM news ORDER BY id DESC LIMIT 20", [], (err, data) =>
        err ? reject(err) : resolve(data),
      );
    });
    res.json({
      news: rows.map((n) => ({
        id: n.id,
        title: n.title,
        content: n.content,
        createdAt: n.created_at,
      })),
    });
  } catch (err) {
    console.error("News list error", err);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.post("/admin/news", authenticate, requireAdmin, async (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ message: "Judul dan konten wajib diisi" });
  }
  const trimmedTitle = String(title).trim();
  const trimmedContent = String(content).trim();
  if (trimmedTitle.length < 3 || trimmedTitle.length > 200) {
    return res.status(400).json({ message: "Judul 3-200 karakter" });
  }
  if (trimmedContent.length < 10) {
    return res.status(400).json({ message: "Konten minimal 10 karakter" });
  }
  try {
    const now = new Date().toISOString();
    const result = await run(
      "INSERT INTO news (title, content, created_at, author_id) VALUES (?, ?, ?, ?)",
      [trimmedTitle, trimmedContent, now, req.user.id],
    );
    return res.status(201).json({
      message: "News ditambahkan",
      news: { id: result.lastID, title: trimmedTitle, content: trimmedContent, createdAt: now },
    });
  } catch (err) {
    console.error("Create news error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.delete("/admin/news/:id", authenticate, requireAdmin, async (req, res) => {
  const newsId = Number(req.params.id);
  if (!Number.isInteger(newsId)) {
    return res.status(400).json({ message: "ID tidak valid" });
  }
  try {
    const target = await new Promise((resolve, reject) => {
      db.get("SELECT id FROM news WHERE id = ?", [newsId], (err, row) => (err ? reject(err) : resolve(row)));
    });
    if (!target) return res.status(404).json({ message: "News tidak ditemukan" });
    await run("DELETE FROM news WHERE id = ?", [newsId]);
    return res.json({ message: "News dihapus" });
  } catch (err) {
    console.error("Delete news error", err);
    return res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

module.exports = router;

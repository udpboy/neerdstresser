import { useCallback, useEffect, useRef, useState } from "react";
import { TrashIcon } from "@radix-ui/react-icons";
import ConfirmDialog from "../components/ConfirmDialog";

const AdminNewsPage = ({ theme, cardClass, token, apiUrl, onNotify }) => {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState({ open: false, id: null, title: "" });
  const fetchedRef = useRef(null);

  const load = useCallback(async (force = false) => {
    if (!force && fetchedRef.current === token) {
      setLoading(false);
      return;
    }
    fetchedRef.current = token;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/news`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal memuat news");
      setNews(data.news || []);
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // keep scroll position while typing long content
    const el = document.getElementById("news-content-input");
    if (el) {
      const { scrollTop } = el;
      el.scrollTop = scrollTop;
    }
  }, [content]);

  const submit = async () => {
    if (!title.trim() || !content.trim()) {
      onNotify?.("error", "Judul dan konten wajib diisi");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/news`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal menambah news");
      setTitle("");
      setContent("");
      onNotify?.("success", "News ditambahkan");
      load(true);
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete.id) return;
    setWorkingId(confirmDelete.id);
    try {
      const res = await fetch(`${apiUrl}/api/admin/news/${confirmDelete.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal menghapus news");
      onNotify?.("success", "News dihapus");
      load(true);
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setWorkingId(null);
      setConfirmDelete({ open: false, id: null, title: "" });
    }
  };

  const inputClass = (mode) =>
    [
      "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2",
      mode === "dark"
        ? "border-slate-600 bg-slate-900 text-slate-100 focus:border-red-500 focus:ring-red-500/30"
        : "border-slate-300 bg-white text-slate-900 focus:border-red-600 focus:ring-red-600/20",
    ].join(" ");

  return (
    <>
      <div className="space-y-4">
        <div className={`${cardClass(theme)} w-full`}>
          <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
            <div className="text-lg font-semibold title-dot">Tambah News</div>
            <span className="text-xs uppercase tracking-wide text-red-300">Admin</span>
          </div>
          <div className="px-5 py-4 sm:px-6 space-y-2 text-sm">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass(theme)}
              placeholder="Judul"
            />
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Konten</label>
              <textarea
                id="news-content-input"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className={[
                  "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2",
                  "whitespace-pre-wrap leading-relaxed text-left font-mono",
                  theme === "dark"
                    ? "border-slate-600 bg-slate-900 text-slate-100 focus:border-red-500 focus:ring-red-500/30"
                    : "border-slate-300 bg-white text-slate-900 focus:border-red-600 focus:ring-red-600/20",
                ].join(" ")}
                placeholder="Tulis berita (boleh HTML sederhana)"
                rows={10}
              />
              <p className="text-xs text-slate-500">
                Format HTML sederhana diperbolehkan. Gunakan Enter untuk paragraf baru.
              </p>
            </div>
            <div className="flex justify-end">
              <button
                onClick={submit}
                disabled={saving}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Memproses..." : "Tambah"}
              </button>
            </div>
          </div>
        </div>

        <div className={`${cardClass(theme)} w-full`}>
          <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
            <div className="text-lg font-semibold title-dot">Daftar News</div>
            <span className="text-xs uppercase tracking-wide text-red-300">Admin</span>
          </div>
          <div
            className={`px-5 py-4 sm:px-6 text-sm ${
              theme === "dark" ? "text-slate-100" : "text-slate-900"
            }`}
          >
            {loading ? (
              <div className="text-slate-400">Memuat...</div>
            ) : (
              <div className="space-y-3 max-h-[360px] overflow-auto pr-1">
                {news.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-lg border px-3 py-2 ${
                      theme === "dark"
                        ? "border-slate-700/50 bg-slate-900"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{item.title}</div>
                      <span className="text-[11px] uppercase tracking-wide text-slate-500">
                        {item.createdAt?.slice(0, 10) || ""}
                      </span>
                    </div>
                    <div
                      className={`mt-1 prose prose-sm max-w-none ${
                        theme === "dark" ? "prose-invert text-slate-300" : "text-slate-800"
                      }`}
                      dangerouslySetInnerHTML={{ __html: item.content }}
                    />
                    <div className="mt-2 flex justify-end">
                      <button
                        title="Delete news"
                        aria-label="Delete news"
                        className="flex h-8 w-8 items-center justify-center rounded border border-red-500 text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                        disabled={workingId === item.id}
                        onClick={() =>
                          setConfirmDelete({
                            open: true,
                            id: item.id,
                            title: item.title || "News",
                          })
                        }
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                ))}
                {news.length === 0 && <div className="text-slate-400">Belum ada berita.</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        theme={theme}
        open={confirmDelete.open}
        title="Hapus News"
        message={
          confirmDelete.title
            ? `Hapus berita "${confirmDelete.title}"? Aksi ini tidak bisa dibatalkan.`
            : "Hapus news ini?"
        }
        confirmText="Hapus"
        cancelText="Batal"
        tone="danger"
        loading={workingId === confirmDelete.id}
        onCancel={() => setConfirmDelete({ open: false, id: null, title: "" })}
        onConfirm={remove}
      />
    </>
  );
};

export default AdminNewsPage;

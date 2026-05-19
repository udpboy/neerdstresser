import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "../components/ConfirmDialog";

const AdminServersPage = ({ theme, cardClass, token, apiUrl, onNotify }) => {
  const [servers, setServers] = useState([]);
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState({ open: false, id: null, name: "" });
  const [form, setForm] = useState({
    name: "",
    apiUrl: "",
    maxConcurrent: 100,
    maxTime: 60,
    layer: "L7",
    status: "online",
    methods: [],
    successCheckEnabled: false,
    successKey: "success",
    successValue: "",
  });
  const sampleValues = { host: "example.com", time: "60", method: "HTTP-GET" };
  const sampleUrl = (form.apiUrl || "[api_url]").replace(/\[host\]/g, sampleValues.host).replace(/\[time\]/g, sampleValues.time).replace(/\[method\]/g, sampleValues.method);
  const fetchedMethodsRef = useRef(null);
  const fetchedServersRef = useRef(null);

  const loadMethods = useCallback(async (force = false) => {
    if (!force && fetchedMethodsRef.current === token) return;
    fetchedMethodsRef.current = token;
    try {
      const res = await fetch(`${apiUrl}/api/admin/methods`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal memuat method");
      setMethods(data.methods || []);
    } catch (err) {
      onNotify?.("error", err.message);
    }
  }, [apiUrl, onNotify, token]);

  const loadServers = useCallback(async (force = false) => {
    if (!force && fetchedServersRef.current === token) return;
    fetchedServersRef.current = token;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/servers`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal memuat server");
      setServers(data.servers || []);
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, onNotify, token]);

  useEffect(() => {
    loadMethods();
    loadServers();
  }, [loadMethods, loadServers]);

  const resetForm = () =>
    setForm({
      name: "",
      apiUrl: "",
      maxConcurrent: 100,
      maxTime: 60,
      layer: "L7",
      status: "online",
      methods: [],
      successCheckEnabled: false,
      successKey: "success",
      successValue: "",
    });

  const filteredMethods = useMemo(
    () => methods.filter((m) => m.layer === form.layer),
    [methods, form.layer],
  );

  const toggleMethod = (id) => {
    setForm((prev) => {
      const exists = prev.methods.includes(id);
      const next = exists ? prev.methods.filter((m) => m !== id) : [...prev.methods, id];
      return { ...prev, methods: next };
    });
  };

  const colorForId = (id) => {
    const palette = ["#e45757", "#c84646", "#ee7f7f", "#a33838", "#f4a6a6", "#7f2c2c", "#f9caca", "#5e1f1f"];
    return palette[Math.abs(id) % palette.length];
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setWorking(true);
    try {
      const payload = {
        name: form.name,
        apiUrl: form.apiUrl,
        maxConcurrent: Number(form.maxConcurrent),
        maxTime: Number(form.maxTime),
        layer: form.layer,
        status: form.status,
        methods: form.methods,
        successCheckEnabled: form.successCheckEnabled,
        successKey: form.successKey,
        successValue: form.successValue,
      };
      const url = editing ? `${apiUrl}/api/admin/servers/${editing.id}` : `${apiUrl}/api/admin/servers`;
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal menyimpan server");
      onNotify?.("success", editing ? "Server diperbarui" : "Server ditambahkan");
      setEditing(null);
      resetForm();
      loadServers();
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setWorking(false);
    }
  };

  const startEdit = (server) => {
    setEditing(server);
    setForm({
      name: server.name,
      apiUrl: server.api_url,
      maxConcurrent: server.max_concurrent,
      maxTime: server.max_time,
      layer: server.layer,
      status: server.status,
      methods: (server.methods || []).map((m) => m.id),
      successCheckEnabled: !!server.success_check_enabled,
      successKey: server.success_key || "success",
      successValue: server.success_value || "",
    });
  };

  const handleDelete = async () => {
    if (!confirmDelete.id) return;
    setWorking(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/servers/${confirmDelete.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal menghapus server");
      onNotify?.("success", "Server dihapus");
      loadServers(true);
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setWorking(false);
      setConfirmDelete({ open: false, id: null, name: "" });
    }
  };

  useEffect(() => {
    // drop method yang tidak sesuai layer saat layer berubah
    setForm((prev) => ({
      ...prev,
      methods: prev.methods.filter((id) => {
        const m = methods.find((x) => x.id === id);
        return m?.layer === form.layer;
      }),
    }));
  }, [form.layer, methods]);

  return (
    <>
      <div className="space-y-4">
        <div className={`${cardClass(theme)} w-full`}>
        <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
          <div className="text-lg font-semibold title-dot">{editing ? "Edit Server" : "Tambah Server"}</div>
          <span className="text-xs uppercase tracking-wide text-red-300">Admin</span>
        </div>
        <form onSubmit={handleSave} className="px-5 py-4 sm:px-6 space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Nama Server</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                placeholder="server-1"
                disabled={working}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">API Server</label>
              <input
                value={form.apiUrl}
                onChange={(e) => setForm({ ...form, apiUrl: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                placeholder="https://api.server.com"
                disabled={working}
              />
              <div className="space-y-1 rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded border border-slate-700 px-2 py-1 font-mono text-[11px] text-slate-200">[host]</span>
                  <span className="rounded border border-slate-700 px-2 py-1 font-mono text-[11px] text-slate-200">[time]</span>
                  <span className="rounded border border-slate-700 px-2 py-1 font-mono text-[11px] text-slate-200">[method]</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Gunakan placeholder di URL. Contoh:
                </p>
                <div className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-[11px] text-red-100">
                  {sampleUrl}
                </div>
              </div>
              <div className="space-y-1 rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.successCheckEnabled}
                      onChange={(e) => setForm({ ...form, successCheckEnabled: e.target.checked })}
                      className="h-4 w-4 accent-red-500"
                      disabled={working}
                    />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-200">
                      Cek respons sukses
                    </span>
                  </label>
                  <span className="text-[11px] text-slate-400">Opsional</span>
                </div>
                {form.successCheckEnabled && (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-[11px] uppercase tracking-wide text-slate-400">Key JSON</label>
                        <input
                          list="success-key-options"
                          value={form.successKey}
                          onChange={(e) => setForm({ ...form, successKey: e.target.value })}
                          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[12px] text-slate-100 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                          placeholder="success"
                          disabled={working}
                        />
                        <datalist id="success-key-options">
                          <option value="success" />
                          <option value="status" />
                          <option value="message" />
                          <option value="ok" />
                        </datalist>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] uppercase tracking-wide text-slate-400">Nilai yang dianggap sukses (kosong = truthy)</label>
                        <input
                          value={form.successValue}
                          onChange={(e) => setForm({ ...form, successValue: e.target.value })}
                          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[12px] text-slate-100 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                          placeholder="true"
                          disabled={working}
                        />
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950 px-2 py-2 text-[11px] text-slate-200">
                      <div className="font-semibold text-red-200">Contoh respons</div>
                      <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-slate-100">
{`{
  "${form.successKey || "success"}": ${form.successValue ? `"${form.successValue}"` : "true"},
  "detail": "ok"
}`}
                      </pre>
                      <div className="mt-1 text-[10px] text-slate-400">
                        Berhasil jika nilai JSON[{form.successKey || "success"}] {form.successValue ? `= "${form.successValue}"` : "truthy"}.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Max Concurrent</label>
              <input
                type="number"
                min={1}
                max={10000}
                value={form.maxConcurrent}
                onChange={(e) => setForm({ ...form, maxConcurrent: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                disabled={working}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Max Time (s)</label>
              <input
                type="number"
                min={1}
                max={86400}
                value={form.maxTime}
                onChange={(e) => setForm({ ...form, maxTime: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                disabled={working}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Layer</label>
              <select
                value={form.layer}
                onChange={(e) => setForm({ ...form, layer: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                disabled={working}
              >
                <option value="L7">Layer 7</option>
                <option value="L4">Layer 4</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                disabled={working}
              >
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-wide text-slate-400">Method ({form.layer})</label>
                <span className="text-[11px] text-slate-500">
                  {form.methods.length}/{filteredMethods.length || 0} dipilih
                </span>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-2">
                {filteredMethods.length === 0 && (
                  <div className="text-xs text-slate-500 px-2 py-1">Belum ada method layer ini.</div>
                )}
                <div className="flex flex-wrap gap-2">
                  {filteredMethods.map((m) => {
                    const active = form.methods.includes(m.id);
                    const color = colorForId(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={working}
                        onClick={() => toggleMethod(m.id)}
                        className={`group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-red-500/40 ${
                          active
                            ? "border-transparent bg-red-600 text-white shadow-md shadow-red-900/30"
                            : "border-slate-700 bg-slate-900 text-slate-100 hover:border-red-500/60 hover:text-white"
                        }`}
                        title={m.display_name}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: color }}
                          aria-hidden="true"
                        />
                        <span className="truncate max-w-[130px]">{m.display_name}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${
                            active ? "bg-white/20 text-white" : "bg-slate-800 text-slate-200"
                          }`}
                        >
                          {m.layer}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  resetForm();
                }}
                className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-400"
                disabled={working}
              >
                Batal
              </button>
            )}
            <button
              type="submit"
              disabled={working}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-60"
            >
              {working ? "Menyimpan..." : editing ? "Simpan" : "Tambah"}
            </button>
          </div>
        </form>
      </div>

      <div className={`${cardClass(theme)} w-full`}>
        <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
          <div className="text-lg font-semibold title-dot">Daftar Server</div>
          <span className="text-xs uppercase tracking-wide text-red-300">Admin</span>
        </div>
        <div className="px-5 py-4 sm:px-6 text-sm">
          {loading ? (
            <div className="text-slate-400">Memuat...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className={theme === "dark" ? "text-slate-400" : "text-slate-500"}>
                  <tr>
                    <th className="py-2 pr-3 text-left">ID</th>
                    <th className="py-2 pr-3 text-left">Nama</th>
                    <th className="py-2 pr-3 text-left">API</th>
                    <th className="py-2 pr-3 text-left">Layer</th>
                    <th className="py-2 pr-3 text-left">Status</th>
                    <th className="py-2 pr-3 text-left">Max Conc/Time</th>
                    <th className="py-2 pr-3 text-left">Method</th>
                    <th className="py-2 pr-3 text-left">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/60">
                  {servers.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2 pr-3 text-slate-300">{s.id}</td>
                      <td className="py-2 pr-3 font-semibold text-slate-100">{s.name}</td>
                      <td className="py-2 pr-3 text-slate-300 truncate max-w-[180px]">{s.api_url}</td>
                      <td className="py-2 pr-3 text-slate-300">{s.layer}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                            s.status === "online"
                              ? "bg-emerald-500/15 text-emerald-200"
                              : s.status === "maintenance"
                                ? "bg-amber-500/15 text-amber-200"
                                : "bg-red-500/15 text-red-200"
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-slate-300">
                        {s.max_concurrent} / {s.max_time}s
                      </td>
                      <td className="py-2 pr-3 text-slate-200">
                        <div className="flex flex-wrap gap-1">
                          {(s.methods || []).map((m) => (
                            <span
                              key={m.id}
                              className="rounded-full bg-slate-700 px-2 py-1 text-[11px] font-semibold text-red-100"
                            >
                              {m.display_name}
                            </span>
                          ))}
                          {(s.methods || []).length === 0 && (
                            <span className="text-slate-500 text-xs">-</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex gap-2">
                          <button
                            className="rounded border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:border-red-400"
                            onClick={() => startEdit(s)}
                            disabled={working}
                          >
                            Edit
                          </button>
                          <button
                            className="rounded border border-red-500 px-2 py-1 text-xs text-red-200 hover:bg-red-500/10"
                            onClick={() =>
                              setConfirmDelete({ open: true, id: s.id, name: s.name || "Server" })
                            }
                            disabled={working}
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {servers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-4 text-center text-slate-400">
                        Belum ada server.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      </div>
      <ConfirmDialog
        theme={theme}
        open={confirmDelete.open}
        title="Hapus Server"
        message={
          confirmDelete.name
            ? `Hapus server "${confirmDelete.name}"? Request yang terkait tidak akan bisa dijalankan.`
            : "Hapus server ini?"
        }
        confirmText="Hapus"
        cancelText="Batal"
        tone="danger"
        loading={working}
        onCancel={() => setConfirmDelete({ open: false, id: null, name: "" })}
        onConfirm={handleDelete}
      />
    </>
  );
};

export default AdminServersPage;

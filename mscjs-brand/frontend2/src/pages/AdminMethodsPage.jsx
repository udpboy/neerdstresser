import { useEffect, useRef, useState } from "react";
import ConfirmDialog from "../components/ConfirmDialog";

const accessBadge = (tier, theme) =>
  tier === "premium"
    ? theme === "dark"
      ? "bg-purple-500/15 text-purple-200 border border-purple-500/30"
      : "bg-purple-50 text-purple-700 border border-purple-200"
    : theme === "dark"
      ? "bg-emerald-500/15 text-emerald-100 border border-emerald-500/30"
      : "bg-emerald-50 text-emerald-700 border border-emerald-200";

const AdminMethodsPage = ({ theme, cardClass, token, apiUrl, onNotify }) => {
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [form, setForm] = useState({
    name: "",
    displayName: "",
    layer: "L7",
    tier: "basic",
    audience: "all",
    description: "",
  });
  const [params, setParams] = useState([]);
  const [paramDraft, setParamDraft] = useState({
    key: "",
    label: "",
    type: "text",
    required: false,
    placeholder: "",
    defaultValue: "",
    options: "",
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState({ open: false, id: null, name: "" });
  const loadedRef = useRef(false);
  const loadingRef = useRef(false);
  const fetchedTokenRef = useRef(null);

  useEffect(() => {
    if (loadedRef.current && fetchedTokenRef.current === token) return;
    const load = async () => {
      if (loadedRef.current || loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const res = await fetch(`${apiUrl}/api/admin/methods`, {
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || "Gagal memuat methods");
        setMethods(data.methods || []);
        loadedRef.current = true;
        fetchedTokenRef.current = token;
      } catch (err) {
        onNotify?.("error", err.message);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, apiUrl]);

  const resetForm = () => {
    setForm({ name: "", displayName: "", layer: "L7", tier: "basic", audience: "all", description: "" });
    setParams([]);
    setParamDraft({
      key: "",
      label: "",
      type: "text",
      required: false,
      placeholder: "",
      defaultValue: "",
      options: "",
    });
  };

  const save = async (e) => {
    e.preventDefault();
    setWorking(true);
    try {
      const payload = {
        name: form.name.trim(),
        displayName: form.displayName.trim(),
        layer: form.layer,
        tier: form.tier,
        audience: form.audience,
        description: form.description.trim() || "test",
        params: params.map((p) => ({
          param_key: p.param_key || p.key,
          label: p.label || p.key,
          type: p.type,
          required: Boolean(p.required),
          placeholder: p.placeholder || "",
          default_value: p.default_value ?? p.defaultValue ?? "",
          options: p.options || "",
        })),
      };
      const url = editing ? `${apiUrl}/api/admin/methods/${editing.id}` : `${apiUrl}/api/admin/methods`;
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
      if (!res.ok) throw new Error(data?.message || "Gagal menyimpan method");
      onNotify?.("success", editing ? "Method diperbarui" : "Method ditambahkan");
      if (editing) {
        setMethods((prev) =>
          prev.map((m) => (m.id === data.method.id ? data.method : m)),
        );
      } else {
        setMethods((prev) => [...prev, data.method]);
      }
      resetForm();
      setEditing(null);
      setShowAdvanced(false);
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete.id) return;
    setWorking(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/methods/${confirmDelete.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal menghapus method");
      onNotify?.("success", "Method dihapus");
      setMethods((prev) => prev.filter((m) => m.id !== confirmDelete.id));
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setWorking(false);
      setConfirmDelete({ open: false, id: null, name: "" });
    }
  };

  const startEdit = (m) => {
    setEditing(m);
    setForm({
      name: m.name,
      displayName: m.display_name,
      layer: m.layer,
      tier: m.tier,
      audience: m.audience,
      description: m.description || "",
    });
    setParams(m.params || []);
    setShowAdvanced(true);
  };

  return (
    <div className="space-y-4">
      <div className={`${cardClass(theme)} w-full`}>
        <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
          <div className="text-lg font-semibold title-dot">{editing ? "Edit Method" : "Tambah Method"}</div>
          <span className="text-xs uppercase tracking-wide text-red-300">Admin</span>
        </div>
        <form onSubmit={save} className="px-5 py-4 sm:px-6 space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Name (slug)</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                placeholder="ex: get-basic"
                disabled={editing}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Display Name</label>
              <input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                placeholder="ex: GET Basic"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wide text-slate-400">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
              placeholder="Deskripsi singkat (default: test)"
              rows={2}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Layer</label>
              <select
                value={form.layer}
                onChange={(e) => setForm({ ...form, layer: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
              >
                <option value="L7">Layer 7</option>
                <option value="L4">Layer 4</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Tier</label>
              <select
                value={form.tier}
                onChange={(e) => setForm({ ...form, tier: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
              >
                <option value="basic">Basic</option>
                <option value="premium">Premium</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Access</label>
              <select
                value={form.audience}
                onChange={(e) => setForm({ ...form, audience: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
              >
                <option value="all">All Users</option>
                <option value="admin">Admin Only</option>
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">Advanced Params</div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="rounded-md border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-100 hover:border-red-400"
            >
              {showAdvanced ? "Sembunyikan" : "Tampilkan"}
            </button>
          </div>
          {showAdvanced && (
            <div className="space-y-3 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-slate-400">Key</label>
                  <input
                    value={paramDraft.key}
                    onChange={(e) => setParamDraft({ ...paramDraft, key: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                    placeholder="connection"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-slate-400">Label</label>
                  <input
                    value={paramDraft.label}
                    onChange={(e) => setParamDraft({ ...paramDraft, label: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                    placeholder="Connection"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-slate-400">Type</label>
                  <select
                    value={paramDraft.type}
                    onChange={(e) => setParamDraft({ ...paramDraft, type: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="select">Select</option>
                    <option value="checkbox">Checkbox</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-slate-400">Placeholder</label>
                  <input
                    value={paramDraft.placeholder}
                    onChange={(e) => setParamDraft({ ...paramDraft, placeholder: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                    placeholder="e.g. 10"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-slate-400">Default</label>
                  <input
                    value={paramDraft.defaultValue}
                    onChange={(e) => setParamDraft({ ...paramDraft, defaultValue: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                    placeholder="test"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-slate-400">Options (comma, for select)</label>
                  <input
                    value={paramDraft.options}
                    onChange={(e) => setParamDraft({ ...paramDraft, options: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                    placeholder="low,medium,high"
                    disabled={paramDraft.type !== "select"}
                  />
                </div>
                <div className="flex items-end gap-3">
                  <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
                    <input
                      type="checkbox"
                      checked={paramDraft.required}
                      onChange={(e) => setParamDraft({ ...paramDraft, required: e.target.checked })}
                      className="h-4 w-4 accent-red-500"
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (!paramDraft.key.trim()) return onNotify?.("error", "Key wajib diisi");
                      setParams((prev) => [
                        ...prev,
                        {
                          param_key: paramDraft.key.trim(),
                          label: paramDraft.label.trim() || paramDraft.key.trim(),
                          type: paramDraft.type,
                          required: paramDraft.required,
                          placeholder: paramDraft.placeholder,
                          default_value: paramDraft.defaultValue,
                          options: paramDraft.options,
                        },
                      ]);
                      setParamDraft({
                        key: "",
                        label: "",
                        type: "text",
                        required: false,
                        placeholder: "",
                        defaultValue: "",
                        options: "",
                      });
                    }}
                    className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-500"
                  >
                    Tambah Parameter
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className={theme === "dark" ? "text-slate-400" : "text-slate-500"}>
                    <tr>
                      <th className="py-2 pr-3 text-left">Key</th>
                      <th className="py-2 pr-3 text-left">Label</th>
                      <th className="py-2 pr-3 text-left">Type</th>
                      <th className="py-2 pr-3 text-left">Req</th>
                      <th className="py-2 pr-3 text-left">Default</th>
                      <th className="py-2 pr-3 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/60">
                    {params.map((p, idx) => (
                      <tr key={`${p.param_key || p.key}-${idx}`}>
                        <td className="py-2 pr-3 text-slate-100">{p.param_key || p.key}</td>
                        <td className="py-2 pr-3 text-slate-300">{p.label}</td>
                        <td className="py-2 pr-3 text-slate-300">{p.type}</td>
                        <td className="py-2 pr-3 text-slate-300">{p.required ? "Yes" : "No"}</td>
                        <td className="py-2 pr-3 text-slate-300">{p.default_value ?? p.defaultValue ?? "-"}</td>
                        <td className="py-2 pr-3">
                          <button
                            type="button"
                            className="rounded border border-red-500 px-2 py-1 text-xs text-red-200 hover:bg-red-500/10"
                            onClick={() => setParams((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            Hapus
                          </button>
                        </td>
                      </tr>
                    ))}
                    {params.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-3 text-center text-slate-400">
                          Belum ada parameter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  resetForm();
                }}
                className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-400"
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
          <div className="text-lg font-semibold title-dot">Daftar Method</div>
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
                    <th className="py-2 pr-3 text-left">Name</th>
                    <th className="py-2 pr-3 text-left">Display</th>
                    <th className="py-2 pr-3 text-left">Layer</th>
                    <th className="py-2 pr-3 text-left">Tier</th>
                    <th className="py-2 pr-3 text-left">Access</th>
                    <th className="py-2 pr-3 text-left">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/60">
                  {methods.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2 pr-3 text-slate-300">{m.id}</td>
                      <td className="py-2 pr-3 font-semibold text-slate-100">{m.name}</td>
                      <td className="py-2 pr-3 text-slate-100">{m.display_name}</td>
                      <td className="py-2 pr-3 text-slate-300">{m.layer}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${accessBadge(m.tier, theme)}`}>
                          {m.tier}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-slate-300">{m.audience === "admin" ? "Admin" : "All"}</td>
                      <td className="py-2 pr-3">
                        <div className="flex gap-2">
                          <button
                            className="rounded border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:border-red-400"
                            onClick={() => startEdit(m)}
                            disabled={working}
                          >
                            Edit
                          </button>
                          <button
                            className="rounded border border-red-500 px-2 py-1 text-xs text-red-200 hover:bg-red-500/10"
                            onClick={() =>
                              setConfirmDelete({
                                open: true,
                                id: m.id,
                                name: m.display_name || m.name,
                              })
                            }
                            disabled={working}
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {methods.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-4 text-center text-slate-400">
                        Belum ada method.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        theme={theme}
        open={confirmDelete.open}
        title="Hapus Method"
        message={
          confirmDelete.name
            ? `Hapus method "${confirmDelete.name}"? Aksi ini tidak bisa dibatalkan.`
            : "Hapus method ini?"
        }
        confirmText="Hapus"
        cancelText="Batal"
        tone="danger"
        loading={working}
        onCancel={() => setConfirmDelete({ open: false, id: null, name: "" })}
        onConfirm={handleDelete}
      />
    </div>
  );
};

export default AdminMethodsPage;

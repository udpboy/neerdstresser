import { useEffect, useRef, useState } from "react";
import ConfirmDialog from "../components/ConfirmDialog";

const AdminPlansPage = ({ theme, cardClass, token, apiUrl, onNotify }) => {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [form, setForm] = useState({
    name: "",
    displayHtml: "",
    maxConcurrent: 1,
    maxTime: 60,
    price: 0,
    discount: 0,
    stock: 0,
    apiAccess: false,
    premiumAccess: false,
    durationType: "days",
    durationValue: 30,
    visibility: "public",
  });
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState({ open: false, id: null, name: "" });
  const fetchedTokenRef = useRef(null);

  const fetchPlans = async (force = false) => {
    if (!force && fetchedTokenRef.current === token) return;
    fetchedTokenRef.current = token;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/plans`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal memuat plans");
      setPlans(data.plans || []);
      fetchedTokenRef.current = token;
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, apiUrl]);

  const resetForm = () => {
    setForm({
      name: "",
      displayHtml: "",
      maxConcurrent: 1,
      maxTime: 60,
      price: 0,
      discount: 0,
      stock: 0,
      apiAccess: false,
      premiumAccess: false,
      durationType: "days",
      durationValue: 30,
      visibility: "public",
    });
    setEditing(null);
  };

  const buildDurationDays = () => {
    if (form.durationType === "lifetime") return null;
    const val = Number(form.durationValue);
    if (!Number.isInteger(val) || val < 1) return null;
    if (form.durationType === "months") return val * 30;
    return val;
  };

  const save = async (e) => {
    e.preventDefault();
    setWorking(true);
    try {
      const durationDays = buildDurationDays();
      const payload = {
        name: form.name.trim(),
        displayHtml: form.displayHtml.trim(),
        maxConcurrent: Number(form.maxConcurrent),
        maxTime: Number(form.maxTime),
        price: Number(form.price),
        discount: Number(form.discount || 0),
        stock: Number(form.stock || 0),
        apiAccess: Boolean(form.apiAccess),
        premiumAccess: Boolean(form.premiumAccess),
        durationDays,
        isPrivate: form.visibility === "private",
      };
      const url = editing ? `${apiUrl}/api/admin/plans/${editing.id}` : `${apiUrl}/api/admin/plans`;
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
      if (!res.ok) throw new Error(data?.message || "Gagal menyimpan plan");
      onNotify?.("success", editing ? "Plan diperbarui" : "Plan ditambahkan");
      if (editing) {
        setPlans((prev) => prev.map((p) => (p.id === data.plan.id ? data.plan : p)));
      } else {
        setPlans((prev) => [...prev, data.plan]);
      }
      resetForm();
      fetchPlans(true);
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setWorking(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete.id) return;
    setWorking(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/plans/${confirmDelete.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal menghapus plan");
      onNotify?.("success", "Plan dihapus");
      setPlans((prev) => prev.filter((p) => p.id !== confirmDelete.id));
      if (editing?.id === confirmDelete.id) resetForm();
      fetchPlans(true);
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setWorking(false);
      setConfirmDelete({ open: false, id: null, name: "" });
    }
  };

  const startEdit = (p) => {
    setEditing(p);
    setForm({
      name: p.name,
      displayHtml: p.display_html,
      maxConcurrent: p.max_concurrent,
      maxTime: p.max_time,
      price: p.price,
      discount: p.discount,
      stock: p.stock,
      apiAccess: p.api_access,
      premiumAccess: p.premium_access,
      durationType: p.duration_days === null ? "lifetime" : "days",
      durationValue: p.duration_days === null ? 30 : p.duration_days,
      visibility: p.is_private ? "private" : "public",
    });
  };

  const cardText = theme === "dark" ? "text-slate-100" : "text-slate-900";

  return (
    <div className="space-y-4">
      <div className={`${cardClass(theme)} w-full`}>
        <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
          <div className="text-lg font-semibold title-dot">{editing ? "Edit Plan" : "Tambah Plan"}</div>
          <span className="text-xs uppercase tracking-wide text-red-300">Admin</span>
        </div>
        <form onSubmit={save} className={`px-5 py-4 sm:px-6 space-y-3 text-sm ${cardText}`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Plan Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                placeholder="basic"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Display (HTML ok)</label>
              <input
                value={form.displayHtml}
                onChange={(e) => setForm({ ...form, displayHtml: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                placeholder='<span class="badge">Basic</span>'
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Max Concurrent</label>
              <input
                type="number"
                min={1}
                value={form.maxConcurrent}
                onChange={(e) => setForm({ ...form, maxConcurrent: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Max Time (s)</label>
              <input
                type="number"
                min={1}
                value={form.maxTime}
                onChange={(e) => setForm({ ...form, maxTime: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Stock</label>
              <input
                type="number"
                min={0}
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Visibility</label>
              <select
                value={form.visibility}
                onChange={(e) => setForm({ ...form, visibility: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
              >
                <option value="public">Public (tampil di store)</option>
                <option value="private">Private (sembunyikan dari store)</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Price</label>
              <input
                type="number"
                min={0}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Discount (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={form.discount}
                onChange={(e) => setForm({ ...form, discount: e.target.value })}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Final Price</label>
              <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-100">
                {Math.max(0, form.price - Math.floor((form.price * (form.discount || 0)) / 100))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-slate-400">Duration</label>
              <select
                value={form.durationType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    durationType: e.target.value,
                    durationValue: e.target.value === "lifetime" ? 30 : form.durationValue,
                  })
                }
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
              >
                <option value="days">Harian</option>
                <option value="months">Bulanan</option>
                <option value="lifetime">Lifetime</option>
              </select>
            </div>
            {form.durationType !== "lifetime" && (
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wide text-slate-400">Jumlah</label>
                <input
                  type="number"
                  min={1}
                  value={form.durationValue}
                  onChange={(e) => setForm({ ...form, durationValue: e.target.value })}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                />
              </div>
            )}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
                <input
                  type="checkbox"
                  checked={form.apiAccess}
                  onChange={(e) => setForm({ ...form, apiAccess: e.target.checked })}
                  className="h-4 w-4 accent-red-500"
                />
                API Access
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
                <input
                  type="checkbox"
                  checked={form.premiumAccess}
                  onChange={(e) => setForm({ ...form, premiumAccess: e.target.checked })}
                  className="h-4 w-4 accent-red-500"
                />
                Premium Access
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            {editing && (
              <button
                type="button"
                onClick={resetForm}
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
          <div className="text-lg font-semibold title-dot">Daftar Plan</div>
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
                    <th className="py-2 pr-3 text-left">Name</th>
                    <th className="py-2 pr-3 text-left">Display</th>
                    <th className="py-2 pr-3 text-left">Limit</th>
                    <th className="py-2 pr-3 text-left">Price</th>
                    <th className="py-2 pr-3 text-left">Stock</th>
                    <th className="py-2 pr-3 text-left">Visibility</th>
                    <th className="py-2 pr-3 text-left">Access</th>
                    <th className="py-2 pr-3 text-left">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/60">
                  {plans.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 pr-3 text-slate-100">{p.name}</td>
                      <td
                        className="py-2 pr-3 text-slate-100"
                        dangerouslySetInnerHTML={{ __html: p.display_html }}
                      />
                      <td className="py-2 pr-3 text-slate-300">
                        {p.max_concurrent} conc / {p.max_time}s
                      </td>
                      <td className="py-2 pr-3 text-slate-300">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-100">{p.final_price}</span>
                          {p.discount ? <span className="text-[11px] text-slate-400">Disc {p.discount}%</span> : null}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-slate-300">{p.stock}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                            p.is_private
                              ? "bg-amber-500/15 text-amber-100 border border-amber-500/40"
                              : "bg-emerald-500/15 text-emerald-100 border border-emerald-500/40"
                          }`}
                        >
                          {p.is_private ? "Private" : "Public"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-slate-300">
                        <div className="flex flex-col text-[11px]">
                          <span className={p.api_access ? "text-emerald-300" : "text-slate-400"}>
                            API {p.api_access ? "Ya" : "Tidak"}
                          </span>
                          <span className={p.premium_access ? "text-emerald-300" : "text-slate-400"}>
                            Premium {p.premium_access ? "Ya" : "Tidak"}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex gap-2">
                          <button
                            className="rounded border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:border-red-400"
                            onClick={() => startEdit(p)}
                            disabled={working}
                          >
                            Edit
                          </button>
                          <button
                            className="rounded border border-red-500 px-2 py-1 text-xs text-red-200 hover:bg-red-500/10"
                            onClick={() =>
                              setConfirmDelete({
                                open: true,
                                id: p.id,
                                name: p.name || "Plan",
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
                  {plans.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-3 text-center text-slate-400">
                        Belum ada plan.
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
        title="Hapus Plan"
        message={
          confirmDelete.name
            ? `Yakin ingin menghapus plan "${confirmDelete.name}"?`
            : "Hapus plan ini?"
        }
        confirmText="Hapus"
        cancelText="Batal"
        tone="danger"
        loading={working}
        onCancel={() => setConfirmDelete({ open: false, id: null, name: "" })}
        onConfirm={remove}
      />
    </div>
  );
};

export default AdminPlansPage;

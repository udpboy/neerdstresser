import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  Cross2Icon,
  SlashIcon,
  Pencil1Icon,
  TrashIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import ConfirmDialog from "../components/ConfirmDialog";

const AdminUsersPage = ({ theme, cardClass, token, apiUrl, onNotify }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [workingId, setWorkingId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [topup, setTopup] = useState({ userId: null, amount: "" });
  const [topupLoading, setTopupLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [plans, setPlans] = useState([]);
  const [planSelection, setPlanSelection] = useState({});
  const fetchedUsersRef = useRef(null);
  const fetchedPlansRef = useRef(null);

  const load = useCallback(async (force = false) => {
    if (!force && fetchedUsersRef.current === token) return;
    fetchedUsersRef.current = token;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/admin/users`, {
        credentials: "include",
      });
      const data = await res.json();
      if (res.status === 403) throw new Error("Akses admin diperlukan");
      if (!res.ok) throw new Error(data?.message || "Gagal memuat user");
      setUsers(data.users || []);
    } catch (err) {
      setError(err.message);
      onNotify?.("error", err.message);
    } finally {
      setLoading(false);
      setWorkingId(null);
    }
  }, [apiUrl, onNotify, token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const fetchPlans = async () => {
      if (fetchedPlansRef.current === token) return;
      fetchedPlansRef.current = token;
      try {
        const res = await fetch(`${apiUrl}/api/admin/plans`, {
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || "Gagal memuat plan");
        setPlans(data.plans || []);
      } catch (err) {
        onNotify?.("error", err.message);
      }
    };
    fetchPlans();
  }, [apiUrl, onNotify, token]);

  const updateUser = async (id, payload) => {
    setWorkingId(id);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/admin/users/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal mengubah user");
      await load(true);
      onNotify?.("success", "User diperbarui");
    } catch (err) {
      setError(err.message);
      onNotify?.("error", err.message);
    } finally {
      setWorkingId(null);
    }
  };

  const deleteUser = async () => {
    if (!deleteTarget?.id) return;
    setWorkingId(deleteTarget.id);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/admin/users/${deleteTarget.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal menghapus user");
      await load(true);
      onNotify?.("success", "User dihapus");
    } catch (err) {
      setError(err.message);
      onNotify?.("error", err.message);
    } finally {
      setWorkingId(null);
      setDeleteTarget(null);
    }
  };

  const startEdit = (user) => {
    setEditing({
      id: user.id,
      username: user.username,
      telegramId: user.telegramId || "",
      isAdmin: user.isAdmin,
      isBanned: user.isBanned,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    await updateUser(editing.id, {
      username: editing.username,
      telegramId: editing.telegramId,
      isAdmin: editing.isAdmin,
      isBanned: editing.isBanned,
    });
    setEditing(null);
  };

  const submitTopup = async () => {
    if (!topup.userId) return;
    const amt = parseInt(topup.amount, 10);
    if (!Number.isInteger(amt) || amt <= 0) {
      onNotify?.("error", "Masukkan nominal yang valid");
      return;
    }
    setTopupLoading(true);
    try {
      const requestId = `topup-${topup.userId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const res = await fetch(`${apiUrl}/api/admin/users/${topup.userId}/balance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ amount: amt, requestId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal menambah saldo");
      onNotify?.("success", "Saldo ditambahkan");
      setUsers((prev) =>
        prev.map((u) => (u.id === topup.userId ? { ...u, balance: data.balance } : u)),
      );
      setTopup({ userId: null, amount: "" });
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setTopupLoading(false);
    }
  };

  const assignPlan = async (userId) => {
    const selected = planSelection[userId];
    if (!selected) {
      onNotify?.("error", "Pilih plan terlebih dahulu");
      return;
    }
    setWorkingId(userId);
    try {
      const res = await fetch(`${apiUrl}/api/admin/users/${userId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ planId: Number(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal menambahkan plan");
      onNotify?.("success", "Plan ditambahkan ke user");
      setPlanSelection((prev) => ({ ...prev, [userId]: "" }));
      await load(true);
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <>
      <div className={`${cardClass(theme)} w-full`}>
        <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
          <div className="text-lg font-semibold title-dot">Kelola User</div>
          <span className="text-xs uppercase tracking-wide text-red-300">Admin</span>
        </div>
        <div className="px-5 py-4 sm:px-6 space-y-4">
          {loading && <div className="text-sm text-slate-400">Memuat...</div>}
          {error && (
            <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}
          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="py-2 pr-4">ID</th>
                    <th className="py-2 pr-4">Username</th>
                    <th className="py-2 pr-4">Telegram</th>
                    <th className="py-2 pr-4">Admin</th>
                    <th className="py-2 pr-4">Banned</th>
                    <th className="py-2 pr-4">Balance</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4">Plan</th>
                    <th className="py-2 pr-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/60">
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="py-2 pr-4 text-slate-300">{u.id}</td>
                      <td className="py-2 pr-4 font-semibold text-slate-100">{u.username}</td>
                      <td className="py-2 pr-4 text-slate-300">{u.telegramId || "-"}</td>
                      <td className="py-2 pr-4 text-slate-300">{u.isAdmin ? "Yes" : "No"}</td>
                      <td className="py-2 pr-4 text-slate-300">{u.isBanned ? "Yes" : "No"}</td>
                      <td className="py-2 pr-4 text-slate-300">{u.balance ?? 0}</td>
                      <td className="py-2 pr-4 text-slate-400">{u.createdAt?.slice(0, 10) || "-"}</td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-col gap-2">
                          <select
                            value={planSelection[u.id] || ""}
                            onChange={(e) =>
                              setPlanSelection((prev) => ({ ...prev, [u.id]: e.target.value }))
                            }
                            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                          >
                            <option value="">Pilih plan</option>
                            {plans.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} (stok {p.stock})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="rounded border border-red-500 px-2 py-1 text-xs font-semibold text-red-100 hover:bg-red-500/10 disabled:opacity-50"
                            onClick={() => assignPlan(u.id)}
                            disabled={workingId === u.id || plans.length === 0}
                          >
                            Tambah Plan
                          </button>
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            title="Tambah saldo"
                            aria-label="Tambah saldo"
                            className="flex h-8 items-center gap-1 rounded border border-emerald-500 px-2 text-emerald-100 hover:bg-emerald-500/10 disabled:opacity-50"
                            disabled={workingId === u.id}
                            onClick={() => setTopup({ userId: u.id, amount: "" })}
                          >
                            <PlusIcon className="h-4 w-4" />
                            <span className="text-xs font-semibold">Topup</span>
                          </button>
                          <button
                            title={u.isAdmin ? "Revoke admin" : "Make admin"}
                            aria-label={u.isAdmin ? "Revoke admin" : "Make admin"}
                            className="flex h-8 w-8 items-center justify-center rounded border border-red-500 text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                            disabled={workingId === u.id}
                            onClick={() => updateUser(u.id, { isAdmin: !u.isAdmin })}
                          >
                            {u.isAdmin ? <Cross2Icon /> : <CheckIcon />}
                          </button>
                          <button
                            title={u.isBanned ? "Unban user" : "Ban user"}
                            aria-label={u.isBanned ? "Unban user" : "Ban user"}
                            className="flex h-8 w-8 items-center justify-center rounded border border-amber-500 text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
                            disabled={workingId === u.id}
                            onClick={() => updateUser(u.id, { isBanned: !u.isBanned })}
                          >
                            <SlashIcon />
                          </button>
                          <button
                            title="Edit detail"
                            aria-label="Edit detail"
                            className="flex h-8 w-8 items-center justify-center rounded border border-slate-500 text-slate-200 hover:bg-slate-500/10 disabled:opacity-50"
                            disabled={workingId === u.id}
                            onClick={() => startEdit(u)}
                          >
                            <Pencil1Icon />
                          </button>
                          <button
                            title="Delete user"
                            aria-label="Delete user"
                            className="flex h-8 w-8 items-center justify-center rounded border border-red-500 text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                            disabled={workingId === u.id}
                            onClick={() => setDeleteTarget(u)}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-4 text-center text-slate-400">
                        Tidak ada data user
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {topup.userId && (
            <div className="rounded-xl border border-emerald-600/50 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-50">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Tambah Saldo</div>
                <div className="flex gap-2">
                  <button
                    className="rounded-full border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:border-slate-400"
                    onClick={() => setTopup({ userId: null, amount: "" })}
                    disabled={topupLoading}
                  >
                    Batal
                  </button>
                  <button
                    className="rounded-full border border-emerald-500 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/10 disabled:opacity-50"
                    onClick={submitTopup}
                    disabled={topupLoading}
                  >
                    {topupLoading ? "Memproses..." : "Kirim"}
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-emerald-200">User</label>
                  <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-3 py-2 text-sm font-semibold">
                    {users.find((x) => x.id === topup.userId)?.username || `ID ${topup.userId}`}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-emerald-200">Amount</label>
                  <input
                    type="number"
                    min="1"
                    value={topup.amount}
                    onChange={(e) => setTopup({ ...topup, amount: e.target.value })}
                    className="w-full rounded-lg border border-emerald-700 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-50 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/30"
                    placeholder="Nominal"
                  />
                </div>
              </div>
            </div>
          )}

          {editing && (
            <div className="mt-4 rounded-xl border border-slate-700/50 bg-slate-800 px-4 py-3 text-sm text-slate-100">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Edit User</div>
                <div className="flex gap-2">
                  <button
                    className="rounded-full border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:border-slate-400"
                    onClick={() => setEditing(null)}
                  >
                    Batal
                  </button>
                  <button
                    className="rounded-full border border-red-500 px-2 py-1 text-xs text-red-100 hover:bg-red-500/10 disabled:opacity-50"
                    disabled={workingId === editing.id}
                    onClick={saveEdit}
                  >
                    Simpan
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-slate-400">Username</label>
                  <input
                    value={editing.username}
                    onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                    placeholder="Username"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-slate-400">Telegram ID (opsional)</label>
                  <input
                    value={editing.telegramId}
                    onChange={(e) => setEditing({ ...editing, telegramId: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                    placeholder="123456789"
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <input
                    type="checkbox"
                    checked={editing.isAdmin}
                    onChange={(e) => setEditing({ ...editing, isAdmin: e.target.checked })}
                  />
                  Admin
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <input
                    type="checkbox"
                    checked={editing.isBanned}
                    onChange={(e) => setEditing({ ...editing, isBanned: e.target.checked })}
                  />
                  Banned
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        theme={theme}
        open={!!deleteTarget}
        title="Hapus User"
        message={
          deleteTarget?.username
            ? `Hapus user "${deleteTarget.username}"? Aksi ini tidak bisa dibatalkan.`
            : "Hapus user ini?"
        }
        confirmText="Hapus"
        cancelText="Batal"
        tone="danger"
        loading={workingId === deleteTarget?.id}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={deleteUser}
      />
    </>
  );
};

export default AdminUsersPage;

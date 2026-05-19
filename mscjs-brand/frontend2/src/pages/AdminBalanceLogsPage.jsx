import { useEffect, useRef, useState } from "react";

const AdminBalanceLogsPage = ({ theme, cardClass, token, apiUrl, onNotify }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [working, setWorking] = useState(false);
  const initialFetchedRef = useRef(null);

  const load = async (opts = {}) => {
    const nextPage = opts.page ?? page;
    const nextSearch = opts.search ?? search;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      if (nextSearch.trim()) params.set("user", nextSearch.trim());
      const res = await fetch(`${apiUrl}/api/admin/balance-logs?${params.toString()}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal memuat logs");
      setLogs(data.logs || []);
      setPage(data.page || 1);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(err.message);
      onNotify?.("error", err.message);
    } finally {
      setLoading(false);
      setWorking(false);
    }
  };

  useEffect(() => {
    if (initialFetchedRef.current === token) return;
    initialFetchedRef.current = token;
    load({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, token]);

  const submitSearch = () => {
    setWorking(true);
    load({ page: 1, search });
  };

  const goPage = (p) => {
    if (p < 1 || p > totalPages) return;
    load({ page: p });
  };

  const badgeClass = (type) =>
    type === "topup"
      ? theme === "dark"
        ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
        : "bg-emerald-50 text-emerald-700 border border-emerald-200"
      : theme === "dark"
        ? "bg-rose-500/15 text-rose-200 border border-rose-500/30"
        : "bg-rose-50 text-rose-700 border border-rose-200";

  return (
    <div className={`${cardClass(theme)} w-full`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/50 px-5 py-4 sm:px-6">
        <div className="text-lg font-semibold title-dot">Logs Saldo</div>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari username"
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
          />
          <button
            type="button"
            onClick={submitSearch}
            disabled={working}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            Cari
          </button>
        </div>
      </div>
      <div className="px-5 py-4 sm:px-6 space-y-4 text-sm">
        {loading && <div className="text-slate-400">Memuat...</div>}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-200">
            {error}
          </div>
        )}
        {!loading && !error && (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="py-2 pr-4">User</th>
                    <th className="py-2 pr-4">Tipe</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Note</th>
                    <th className="py-2 pr-4">By</th>
                    <th className="py-2 pr-4">Waktu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/60">
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2 pr-4 font-semibold text-slate-100">
                        {l.user?.username} <span className="text-xs text-slate-500">#{l.user?.id}</span>
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${badgeClass(l.type)}`}>
                          {l.type}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-emerald-200 font-semibold">{l.amount}</td>
                      <td className="py-2 pr-4 text-slate-300">{l.note || "-"}</td>
                      <td className="py-2 pr-4 text-slate-300">
                        {l.admin ? `${l.admin.username} (#${l.admin.id})` : "system"}
                      </td>
                      <td className="py-2 pr-4 text-slate-400">
                        {l.createdAt ? new Date(l.createdAt).toLocaleString() : "-"}
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-slate-400">
                        Tidak ada data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => goPage(page - 1)}
                  disabled={page <= 1}
                  className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-200 hover:border-red-500 disabled:opacity-50"
                >
                  Prev
                </button>
                <div className="text-xs text-slate-400">
                  Page {page} / {totalPages}
                </div>
                <button
                  type="button"
                  onClick={() => goPage(page + 1)}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-200 hover:border-red-500 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminBalanceLogsPage;

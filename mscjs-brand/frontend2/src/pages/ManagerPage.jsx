import { useCallback, useEffect, useRef, useState } from "react";
import { ReloadIcon } from "@radix-ui/react-icons";

const ManagerPage = ({ theme, cardClass, apiUrl, token, onNotify, lang, t }) => {
  const [apiKey, setApiKey] = useState(null);
  const [createdAt, setCreatedAt] = useState(null);
  const [settings, setSettings] = useState({
    active: true,
    loggingEnabled: true,
    autoBind: false,
    whitelist: ["", "", ""],
  });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [purging, setPurging] = useState(false);
  const tr = (key) => t(lang, key);
  const fetchedRef = useRef({ key: null, logs: null });

  const fetchKey = useCallback(async (force = false) => {
    if (!force && fetchedRef.current.key === token) return;
    fetchedRef.current.key = token;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/manager/key`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal memuat API key");
      setApiKey(data.apiKey);
      setCreatedAt(data.createdAt);
      setSettings({
        active: data.active ?? true,
        loggingEnabled: data.loggingEnabled ?? true,
        autoBind: data.autoBind ?? false,
        whitelist: data.whitelist || [],
      });
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, onNotify, token]);

  const fetchLogs = useCallback(async (force = false) => {
    if (!force && fetchedRef.current.logs === token) return;
    fetchedRef.current.logs = token;
    setLoadingLogs(true);
    try {
      const res = await fetch(`${apiUrl}/api/manager/logs`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal memuat log");
      setLogs(data.logs || []);
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setLoadingLogs(false);
    }
  }, [apiUrl, onNotify, token]);

  const purgeLogs = async () => {
    setPurging(true);
    try {
      const res = await fetch(`${apiUrl}/api/manager/logs/purge`, {
        method: "GET",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal hapus log");
      await fetchLogs(true);
      onNotify?.("success", "Log dibersihkan");
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setPurging(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    fetchKey();
    fetchLogs();
  }, [fetchKey, fetchLogs, token]);

  const regenerate = async () => {
    setWorking(true);
    try {
      const res = await fetch(`${apiUrl}/api/manager/key`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal membuat API key");
      setApiKey(data.apiKey);
      setCreatedAt(data.createdAt);
      setSettings({ active: true, loggingEnabled: true, autoBind: false, whitelist: [] });
      onNotify?.("success", "API key diperbarui");
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setWorking(false);
    }
  };

  const saveSettings = async () => {
    setWorking(true);
    try {
      const res = await fetch(`${apiUrl}/api/manager/key/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          active: settings.active,
          loggingEnabled: settings.loggingEnabled,
          autoBind: settings.autoBind,
          whitelist: settings.whitelist.filter((w) => w.trim()),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal menyimpan");
      onNotify?.("success", "Pengaturan disimpan");
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setWorking(false);
    }
  };

  const copyKey = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey).then(() => onNotify?.("success", "API key disalin"));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3 items-start">
        <div className={`${cardClass(theme)} w-full lg:col-span-2`}>
          <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
            <div className="text-lg font-semibold title-dot">{tr("manager.logsTitle")}</div>
            <span className="text-xs uppercase tracking-wide text-red-300">{tr("manager.apiBadge")}</span>
          </div>
          <div className="px-5 py-4 sm:px-6 text-sm overflow-hidden">
            {loadingLogs ? (
              <div className="text-slate-400">{tr("common.loading")}</div>
            ) : logs.length === 0 ? (
              <div className="text-slate-400">{tr("manager.noLogs")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-auto min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th className="py-2 pr-3">{tr("manager.table.host")}</th>
                      <th className="py-2 pr-3">{tr("manager.table.method")}</th>
                      <th className="py-2 pr-3">{tr("manager.table.time")}</th>
                      <th className="py-2 pr-3">{tr("manager.table.conc")}</th>
                      <th className="py-2 pr-3">{tr("manager.table.status")}</th>
                      <th className="py-2 pr-3">{tr("manager.table.date")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/60">
                    {logs.map((l) => (
                      <tr key={l.id}>
                        <td className="py-2 pr-3 text-slate-100">{l.host}</td>
                        <td className="py-2 pr-3 text-slate-100">{l.method}</td>
                        <td className="py-2 pr-3 text-slate-300">{l.time}s</td>
                        <td className="py-2 pr-3 text-slate-300">{l.concurrent}</td>
                        <td className="py-2 pr-3 text-slate-200">{l.status}</td>
                        <td className="py-2 pr-3 text-slate-400">{l.createdAt ? new Date(l.createdAt).toLocaleString() : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className={`${cardClass(theme)} w-full`}>
          <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
            <div className="text-lg font-semibold title-dot">{tr("manager.title")}</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={purgeLogs}
                disabled={purging || loadingLogs}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-100 hover:border-red-400 disabled:opacity-50"
              >
                {tr("manager.purge")}
              </button>
            </div>
          </div>
          <div className="px-5 py-4 sm:px-6 space-y-4 text-sm">
            {loading ? (
              <div className="text-slate-400">{tr("common.loading")}</div>
            ) : (
              <>
                <div className="text-xs font-semibold text-slate-200">
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
                    <span>{tr("manager.apiKeyActive")}</span>
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, active: !settings.active })}
                      className={`relative h-5 w-10 rounded-full transition ${settings.active ? "bg-red-600" : "bg-slate-600"}`}
                      aria-pressed={settings.active}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
                          settings.active ? "left-5" : "left-0.5"
                        }`}
                      />
                    </button>
                  </label>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">API Key</div>
                  <div
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 cursor-pointer hover:border-red-500/70 transition"
                    onClick={copyKey}
                    title="Klik untuk copy API key"
                  >
                    <div className="flex items-center gap-2">
                      <div className="break-all text-slate-50 flex-1">{apiKey || "Belum ada. Klik generate."}</div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          regenerate();
                        }}
                        disabled={working}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-600 bg-slate-800 text-red-300 hover:border-red-400 disabled:opacity-50"
                        aria-label="Regenerate API key"
                        title="Regenerate API key"
                      >
                        <ReloadIcon className={`h-4 w-4 ${working ? "animate-spin" : ""}`} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  {t(lang, "common.status")}: <span className="font-semibold text-slate-200">{createdAt ? new Date(createdAt).toLocaleString() : "-"}</span>
                </div>
                <div className="space-y-2 text-xs font-semibold text-slate-200">
                  {[
                    { key: "loggingEnabled", label: tr("manager.logging") },
                    { key: "autoBind", label: tr("manager.autoBind") },
                  ].map((item) => (
                    <label
                      key={item.key}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                    >
                      <span>{item.label}</span>
                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, [item.key]: !settings[item.key] })}
                        className={`relative h-5 w-10 rounded-full transition ${settings[item.key] ? "bg-red-600" : "bg-slate-600"}`}
                        aria-pressed={settings[item.key]}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
                            settings[item.key] ? "left-5" : "left-0.5"
                          }`}
                        />
                      </button>
                    </label>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-500">
                    <span>{tr("manager.whitelistTitle")}</span>
                    <button
                      type="button"
                      disabled={settings.whitelist.length >= 3}
                      onClick={() =>
                        setSettings({
                          ...settings,
                          whitelist: [...settings.whitelist, ""].slice(0, 3),
                        })
                      }
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-600 bg-slate-800 text-slate-100 hover:border-red-500 disabled:opacity-40"
                      title="Tambah IP"
                    >
                      +
                    </button>
                  </div>
                  {settings.whitelist.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
                      {tr("manager.whitelistEmpty")}
                    </div>
                  ) : (
                    settings.whitelist.map((w, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          value={w}
                          onChange={(e) => {
                            const next = [...settings.whitelist];
                            next[idx] = e.target.value;
                            setSettings({ ...settings, whitelist: next });
                          }}
                          placeholder="1.2.3.4"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                        />
                        <button
                          type="button"
                      onClick={() => {
                        const next = settings.whitelist.filter((_, i) => i !== idx);
                        setSettings({ ...settings, whitelist: next });
                      }}
                      className="h-10 w-10 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-red-500 hover:text-red-400"
                          title="Hapus IP"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                  <div className="text-xs text-slate-400">{tr("manager.whitelistHint")}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={saveSettings}
                    disabled={working || !apiKey}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-900/30 hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-900/40 disabled:opacity-50 disabled:shadow-none transition"
                  >
                    <span className="inline-block h-2 w-2 rounded-full bg-white/80" />
                    {tr("manager.saveBtn")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {/* API Docs card removed */}
    </div>
  );
};

export default ManagerPage;

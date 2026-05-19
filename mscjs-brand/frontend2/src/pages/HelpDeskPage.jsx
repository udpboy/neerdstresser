import { useEffect, useRef, useState } from "react";

const HelpDeskPage = ({ theme, cardClass, token, apiUrl, onNotify, lang, t }) => {
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchedRef = useRef(null);
  const tr = (key) => t(lang, key);

  useEffect(() => {
    const load = async () => {
      if (!token) return;
      if (fetchedRef.current === token) {
        setLoading(false);
        return;
      }
      fetchedRef.current = token;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiUrl}/api/methods`, {
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || "Gagal memuat metode");
        setMethods(data.methods || []);
      } catch (err) {
        setError(err.message);
        onNotify?.("error", err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [apiUrl, token, onNotify]);

  const subtle = theme === "dark" ? "text-slate-400" : "text-slate-600";
  const text = theme === "dark" ? "text-slate-100" : "text-slate-900";
  const border = theme === "dark" ? "border-slate-700/60" : "border-slate-200";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1 sm:px-0">
        <div>
          <div className="text-xs uppercase tracking-wide text-red-300">{tr("help.title")}</div>
          <div className="text-lg font-semibold title-dot">{tr("help.apiReference")}</div>
        </div>
        <div className={`text-xs font-semibold ${subtle}`}>{tr("help.subtitle")}</div>
      </div>

      {loading && <div className="text-sm text-slate-400">{tr("help.loading")}</div>}
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-3">
          {methods.map((m) => (
            <div key={m.id} className={`${cardClass(theme)} w-full`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/50 px-5 py-4 sm:px-6">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-red-500" aria-hidden="true" />
                    <div className="text-lg font-semibold">{m.display_name}</div>
                  </div>
                  <div className={`text-xs ${subtle}`}>ID: {m.id} • Name: {m.name} • Layer: {m.layer} • Tier: {m.tier}</div>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                    theme === "dark" ? "border-slate-700 bg-slate-900 text-slate-200" : "border-slate-200 bg-slate-100 text-slate-700"
                  }`}
                >
                  Audience: {m.audience}
                </span>
              </div>
              <div className={`px-5 py-4 sm:px-6 space-y-3 text-sm ${text}`}>
                <div className={`${subtle} whitespace-pre-line`}>{m.description || tr("help.noDescription")}</div>
                <div className={`rounded-lg border ${border} p-3`}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-red-300">{tr("help.params")}</div>
                  {(() => {
                    const baseParams = [
                      { label: "apiKey", type: "string", required: true, default_value: "-", placeholder: tr("help.baseParams.apiKey") },
                      { label: "id (path)", type: "number", required: true, default_value: "-", placeholder: tr("help.baseParams.id") },
                      { label: "host", type: "string", required: true, default_value: "-", placeholder: tr("help.baseParams.host") },
                      { label: "time", type: "number", required: true, default_value: "-", placeholder: tr("help.baseParams.time") },
                      { label: "concurrent", type: "number", required: true, default_value: "-", placeholder: tr("help.baseParams.concurrent") },
                      { label: "methodId", type: "number", required: true, default_value: "-", placeholder: tr("help.baseParams.methodId") },
                    ];
                    const paramsList = [...baseParams, ...(m.params || [])];
                    if (paramsList.length === 0) {
                      return <div className={`text-sm ${subtle} mt-2`}>{tr("help.noParams")}</div>;
                    }
                    return (
                      <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className={subtle}>
                              <th className="py-1 pr-3 text-left">{tr("help.paramsHeaders.label")}</th>
                              <th className="py-1 pr-3 text-left">{tr("help.paramsHeaders.type")}</th>
                              <th className="py-1 pr-3 text-left">{tr("help.paramsHeaders.required")}</th>
                              <th className="py-1 pr-3 text-left">{tr("help.paramsHeaders.default")}</th>
                              <th className="py-1 pr-3 text-left">{tr("help.paramsHeaders.placeholder")}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-700/40">
                            {paramsList.map((p, idx) => (
                              <tr key={p.id || p.param_key || `${m.id}-${idx}`}>
                                <td className={`py-1 pr-3 ${text}`}>{p.label}</td>
                                <td className={`py-1 pr-3 ${text}`}>{p.type}</td>
                                <td className={`py-1 pr-3 ${text}`}>{p.required ? "Yes" : "No"}</td>
                                <td className={`py-1 pr-3 ${text}`}>{p.default_value ?? "-"}</td>
                                <td className={`py-1 pr-3 ${text}`}>
                                  {p.type === "select" && p.options
                                    ? (p.options || "")
                                        .split(",")
                                        .map((o) => o.trim())
                                        .filter(Boolean)
                                        .join(", ")
                                    : p.placeholder || "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          ))}
          {methods.length === 0 && (
            <div className={`${cardClass(theme)} w-full px-4 py-3 text-sm ${subtle}`}>{tr("common.none")}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default HelpDeskPage;

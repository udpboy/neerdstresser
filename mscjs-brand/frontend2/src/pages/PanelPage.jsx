import { useCallback, useEffect, useRef, useState } from "react";

const OngoingCard = ({ theme, cardClass, token, apiUrl, onNotify, isEditing, refreshKey, lang, t }) => {
  const [ongoing, setOngoing] = useState([]);
  const [maxConcurrent, setMaxConcurrent] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const fetchingRef = useRef(false);
  const stoppingRef = useRef(false);
  const isEditingRef = useRef(false);
  const lastFetchRef = useRef(0);
  const ongoingLoadedRef = useRef(null);
  const tr = (key) => t(lang, key);

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  const refresh = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchRef.current < 5000) return;
    if (!token || (!force && document.hidden) || fetchingRef.current || isEditingRef.current) return;
    fetchingRef.current = true;
    lastFetchRef.current = now;
    try {
      const res = await fetch(`${apiUrl}/api/panel/ongoing`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal memuat ongoing");
      setOngoing(data.tasks || []);
      setMaxConcurrent(data.maxConcurrent ?? null);
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      fetchingRef.current = false;
    }
  }, [apiUrl, onNotify, token]);

  const stopTask = async (id) => {
    if (!token || stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      const res = await fetch(`${apiUrl}/api/panel/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ taskId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal menghentikan");
      onNotify?.("success", tr("panel.success.stopped"));
      refresh(true);
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      stoppingRef.current = false;
    }
  };

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!token || ongoingLoadedRef.current === token) return undefined;
    ongoingLoadedRef.current = token;
    refresh(true);
  }, [token, refresh]);

  useEffect(() => {
    if (refreshKey === 0) return;
    refresh(true);
  }, [refreshKey, refresh]);

  return (
    <div className={`${cardClass(theme)} w-full flex-1 md:basis-3/5 lg:basis-2/3`}>
      <div className="border-b border-slate-700/50 px-5 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold title-dot">{tr("panel.ongoing.title")}</div>
          <div className="text-xs text-slate-400">
            {maxConcurrent != null ? `${ongoing.length}/${maxConcurrent}` : `${ongoing.length}`} {tr("common.status")}
          </div>
        </div>
      </div>
      <div
        className={`px-5 py-4 sm:px-6 text-sm ${
          theme === "dark" ? "text-slate-100" : "text-slate-900"
        }`}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className={theme === "dark" ? "text-slate-400" : "text-slate-500"}>
                <th className="py-2 pr-3 text-left">{tr("panel.ongoing.headers.host")}</th>
                <th className="py-2 pr-3 text-left">{tr("panel.ongoing.headers.method")}</th>
                <th className="py-2 pr-3 text-left">{tr("panel.ongoing.headers.server")}</th>
                <th className="py-2 pr-3 text-left">{tr("panel.ongoing.headers.conc")}</th>
                <th className="py-2 pr-3 text-left">{tr("panel.ongoing.headers.status")}</th>
                <th className="py-2 pr-3 text-left">{tr("panel.ongoing.headers.time")}</th>
                <th className="py-2 pr-3 text-left">{tr("panel.ongoing.headers.action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {ongoing.map((row) => {
                const targetTime = row.status === "scheduled" ? row.startAt : row.endsAt;
                const left = Math.max(0, Math.ceil((targetTime - nowTick) / 1000));
                const pct =
                  row.status === "scheduled"
                    ? 0
                    : Math.max(0, Math.min(100, (left / row.time) * 100));
                return (
                  <tr key={row.id}>
                    <td className="py-2 pr-3 text-slate-100">{row.host}</td>
                    <td className="py-2 pr-3 text-slate-300">{row.displayName}</td>
                    <td className="py-2 pr-3 text-slate-300">{row.serverName}</td>
                    <td className="py-2 pr-3 text-slate-300">{row.concurrent || 1}</td>
                    <td className="py-2 pr-3 text-slate-300">
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                          row.status === "scheduled"
                            ? "bg-amber-500/15 text-amber-200 border border-amber-500/30"
                            : "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
                        }`}
                      >
                        {row.status === "scheduled" ? tr("panel.ongoing.scheduled") : tr("panel.ongoing.running")}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-300">
                      <div className="flex items-center gap-2">
                        {row.status === "running" && (
                          <div className="h-2 flex-1 rounded-full bg-slate-700">
                            <div
                              className="h-2 rounded-full bg-red-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                        <span className="text-xs text-slate-400">
                          {row.status === "scheduled" ? `${tr("panel.ongoing.scheduled")} ${left}s` : `${left}s`}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-slate-300">
                      <button
                        type="button"
                        onClick={() => stopTask(row.id)}
                        disabled={row.status === "scheduled"}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-white text-xs font-bold transition ${
                          row.status === "scheduled"
                            ? "bg-slate-600 cursor-not-allowed"
                            : "bg-red-600 hover:bg-red-500"
                        }`}
                        title={row.status === "scheduled" ? tr("panel.ongoing.scheduled") : "Stop"}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
              {ongoing.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-500">
                    {tr("panel.ongoing.none")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const CONCURRENT_STORAGE_KEY = "panelConcurrent";

const PanelPage = ({ theme, cardClass, token, apiUrl, onNotify, lang, t }) => {
  const [form, setForm] = useState({
    layer: "L7",
    host: "",
    path: "/",
    port: "443",
    time: "60",
    method: "",
    concurrent: 10,
  });
  const [methods, setMethods] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [ongoingRefreshKey, setOngoingRefreshKey] = useState(0);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const scheduleRef = useRef(null);
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);
  const [planLimit, setPlanLimit] = useState({ maxConcurrent: null });
  const [refreshing, setRefreshing] = useState(false);
  const editTimer = useRef(null);
  const formRef = useRef(null);
  const panelLoadedRef = useRef(null);

  const inputClass = [
    "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 transition",
    theme === "dark"
      ? "border-slate-600 bg-slate-900 text-slate-100 focus:border-red-500 focus:ring-red-500/30"
      : "border-slate-300 bg-white text-slate-900 focus:border-red-600 focus:ring-red-600/20",
  ].join(" ");

  const tr = (key) => t(lang, key);
  const labelClass = `text-xs font-semibold uppercase tracking-wide ${
    theme === "dark" ? "text-slate-400" : "text-slate-500"
  }`;

  const markEditing = () => {
    setIsEditing(true);
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => setIsEditing(false), 5000);
  };

  const onChange = (key, value) => {
    markEditing();
    const nextVal = key === "concurrent" ? clampConcurrent(value) : value;
    setForm((prev) => ({ ...prev, [key]: nextVal }));
    if (key === "concurrent") {
      localStorage.setItem(CONCURRENT_STORAGE_KEY, String(nextVal));
    }
  };
  const [methodOpen, setMethodOpen] = useState(false);
  const methodRef = useRef(null);
  const [advancedValues, setAdvancedValues] = useState({});

  const maxConc = Number.isFinite(planLimit?.maxConcurrent) && planLimit.maxConcurrent > 0 ? planLimit.maxConcurrent : null;
  const clampConcurrent = useCallback(
    (val, limit = maxConc) => {
      const lim = Number.isFinite(limit) && limit > 0 ? limit : null;
      const num = Number(val) || 1;
      if (!lim) return Math.max(1, num);
      return Math.min(Math.max(1, num), lim);
    },
    [maxConc],
  );
  const progress = maxConc ? Math.min(Math.max((form.concurrent - 1) / Math.max(maxConc - 1, 1), 0), 1) : 0;
  const colorForId = (id) => {
    const palette = [
      "#e45757",
      "#c84646",
      "#ee7f7f",
      "#a33838",
      "#f4a6a6",
      "#7f2c2c",
      "#f9caca",
      "#5e1f1f",
    ];
    const idx = Math.abs(id) % palette.length;
    return palette[idx];
  };
  const filteredMethods = methods.filter((m) => m.layer === form.layer);
  const selectedMethod = filteredMethods.find((m) => String(m.id) === form.method);
  const selectedColor = selectedMethod ? colorForId(selectedMethod.id) : null;
  const methodStyle = selectedColor
    ? {
        backgroundColor: `${selectedColor}26`,
        borderColor: selectedColor,
      }
    : {};
  const formatDateInput = (date) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const switchLayer = (nextLayer) => {
    const next = methods.find((m) => m.layer === nextLayer);
    setForm((prev) => ({
      ...prev,
      layer: nextLayer,
      method: next ? String(next.id) : "",
    }));
  };

  useEffect(() => {
    if (!selectedMethod) return;
    const defaults = {};
    (selectedMethod.params || []).forEach((p) => {
      const key = p.param_key || p.key;
      if (p.default_value !== undefined && p.default_value !== null && p.default_value !== "") {
        defaults[key] = p.default_value;
      } else if (p.type === "checkbox") {
        defaults[key] = false;
      } else {
        defaults[key] = "";
      }
    });
    setAdvancedValues(defaults);
  }, [selectedMethod]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!form.method) return onNotify?.("error", tr("panel.errors.chooseMethod"));
    if (!form.host.trim()) return onNotify?.("error", tr("panel.errors.hostRequired"));
    if (maxConc === 0) return onNotify?.("error", tr("panel.errors.noPlan"));
    const concurrentVal = clampConcurrent(Number(form.concurrent));
    setIsEditing(false);
    try {
      const payload = {
        host: form.host.trim(),
        time: Number(form.time),
        concurrent: concurrentVal,
        methodId: Number(form.method),
        params: advancedValues,
      };
      if (scheduleAt) {
        const ts = new Date(scheduleAt).getTime();
        if (!Number.isFinite(ts) || ts <= Date.now()) {
          onNotify?.("error", tr("panel.errors.scheduleFuture"));
          return;
        }
        payload.scheduledAt = ts;
      }
      const res = await fetch(`${apiUrl}/api/panel/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || tr("panel.errors.noPlan"));
      const sent = Array.isArray(data?.tasks) ? data.tasks.length : concurrentVal;
      const label = payload.scheduledAt
        ? tr("panel.success.scheduled")
        : sent !== concurrentVal
          ? tr("panel.success.partial")(sent, concurrentVal)
          : tr("panel.success.sent");
      onNotify?.("success", label);
      setOngoingRefreshKey((v) => v + 1);
      if (payload.scheduledAt) {
        setScheduleAt("");
        setShowSchedule(false);
      }
    } catch (err) {
      onNotify?.("error", err.message);
    }
  };

  useEffect(() => {
    const savedConc = localStorage.getItem(CONCURRENT_STORAGE_KEY);
    if (savedConc) {
      const num = Number(savedConc);
      if (Number.isInteger(num) && num >= 0 && num <= 100) {
        setForm((prev) => ({ ...prev, concurrent: clampConcurrent(num) }));
      }
    }
  }, [clampConcurrent]);

  useEffect(() => {
    setForm((prev) => ({ ...prev, concurrent: clampConcurrent(prev.concurrent) }));
  }, [clampConcurrent]);

  const loadPlanAndMethods = useCallback(
    async (force = false) => {
      if (!token && !force) return;
      if (!force && methods.length) return;
      try {
        const resPlan = await fetch(`${apiUrl}/api/plan/me`, {
          credentials: "include",
        });
        const planData = await resPlan.json();
        if (resPlan.ok && planData?.plan) {
          const limit = Math.max(0, planData.plan.maxConcurrent || 0);
          setPlanLimit({ maxConcurrent: limit });
          setForm((prev) => ({ ...prev, concurrent: clampConcurrent(prev.concurrent, limit) }));
        } else {
          setPlanLimit({ maxConcurrent: null });
          setForm((prev) => ({ ...prev, concurrent: clampConcurrent(prev.concurrent, null) }));
        }
      } catch {
        // ignore plan fetch errors
      }

      try {
        const res = await fetch(`${apiUrl}/api/methods`, {
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || "Gagal memuat methods");
        const list = data.methods || [];
        setMethods(list);
        setForm((prev) => {
          const first = list.find((m) => m.layer === prev.layer) || list[0];
          return {
            ...prev,
            layer: first ? first.layer : prev.layer,
            method: first ? String(first.id) : "",
          };
        });
      } catch (err) {
        onNotify?.("error", err.message);
      }
    },
    [apiUrl, clampConcurrent, onNotify, token],
  );

  useEffect(() => {
    if (!methods.length) return;
    setForm((prev) => {
      const exists = methods.find((m) => String(m.id) === prev.method);
      if (exists) return prev;
      const first = methods.find((m) => m.layer === prev.layer) || methods[0];
      if (!first) return prev;
      return {
        ...prev,
        layer: first.layer,
        method: String(first.id),
      };
    });
  }, [methods]);

  const refreshPanel = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    await loadPlanAndMethods(true);
    setOngoingRefreshKey((v) => v + 1);
    setRefreshing(false);
  }, [loadPlanAndMethods, refreshing]);

  useEffect(() => {
    if (!token) return;
    if (panelLoadedRef.current === token) return;
    panelLoadedRef.current = token;
    loadPlanAndMethods();
  }, [loadPlanAndMethods, token]);

  useEffect(() => {
    const handleClick = (evt) => {
      if (methodRef.current && !methodRef.current.contains(evt.target)) {
        setMethodOpen(false);
      }
      if (scheduleRef.current && !scheduleRef.current.contains(evt.target)) {
        setScheduleOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(
    () => () => {
      if (editTimer.current) clearTimeout(editTimer.current);
    },
    []
  );

  return (
    <div className="flex w-full flex-col gap-4 md:flex-row md:items-start md:gap-4 md:overflow-visible md:pb-2">
      <div className={`${cardClass(theme)} w-full md:basis-2/5 lg:basis-1/3 md:max-w-[420px]`}>
        <div className="border-b border-slate-700/50 px-5 py-4 sm:px-6 flex items-center justify-between gap-2">
          <div className="text-lg font-semibold title-dot">{tr("panel.title")}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshPanel}
              disabled={refreshing}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                theme === "dark"
                  ? "border-slate-700 bg-slate-800 text-slate-200 hover:border-red-500/60"
                  : "border-slate-200 bg-white text-slate-700 hover:border-red-500/60"
              } ${refreshing ? "opacity-60 cursor-not-allowed" : ""}`}
              title={tr("common.refresh")}
            >
              <span className="text-base">↻</span>
              <span className="text-[11px]">{tr("common.refresh")}</span>
            </button>
            <div className="relative" ref={scheduleRef}>
              <button
                type="button"
                onClick={() => setScheduleOpen((v) => !v)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  scheduleOpen
                    ? "border-red-500 bg-red-600 text-white"
                    : theme === "dark"
                      ? "border-slate-700 bg-slate-800 text-slate-200 hover:border-red-500/60"
                      : "border-slate-200 bg-white text-slate-700 hover:border-red-500/60"
                }`}
                title={tr("panel.schedule")}
              >
                <span className="text-lg">⏱</span>
                <span className="text-[11px]">{scheduleOpen ? "▲" : "▼"}</span>
              </button>
              {scheduleOpen && (
                <div
                  className={`absolute right-0 z-20 mt-2 w-60 rounded-lg border shadow-lg ${
                    theme === "dark"
                      ? "border-slate-700 bg-slate-800 text-slate-100"
                      : "border-slate-200 bg-white text-slate-900"
                  }`}
                >
                  <div className="border-b border-slate-700/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-red-300">
                    {tr("panel.schedule")}
                  </div>
                  <div className="p-3 space-y-2 text-sm">
                    <label className={labelClass}>{tr("panel.pickTime")}</label>
                    <div className="flex flex-wrap gap-2">
                      {[5, 15, 30, 60].map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`rounded-md border px-2 py-1 text-xs font-semibold transition ${
                            theme === "dark"
                              ? "border-slate-600 bg-slate-800 text-slate-100 hover:border-red-500/60"
                              : "border-slate-200 bg-white text-slate-800 hover:border-red-500/60"
                          }`}
                          onClick={() => {
                            const dt = new Date(Date.now() + m * 60 * 1000);
                            const v = formatDateInput(dt);
                            setScheduleAt(v);
                            setShowSchedule(true);
                          }}
                        >
                          +{m}m
                        </button>
                      ))}
                    </div>
                    <input
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(e) => {
                        setScheduleAt(e.target.value);
                        setShowSchedule(Boolean(e.target.value));
                      }}
                      className={inputClass}
                    />
                    <p className="text-[11px] text-slate-400">
                      {tr("panel.hints.scheduleInfo")}
                    </p>
                    {scheduleAt && (
                      <button
                        type="button"
                        onClick={() => {
                          setScheduleAt("");
                          setShowSchedule(false);
                        }}
                        className="w-full rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/10"
                      >
                        {tr("common.delete")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div
          className={`px-5 py-4 sm:px-6 text-sm ${
            theme === "dark" ? "text-slate-100" : "text-slate-900"
          }`}
        >
          <form className="space-y-4" onSubmit={onSubmit} ref={formRef}>
            <div className="flex flex-wrap justify-center gap-2 sm:gap-3 md:flex-nowrap md:justify-center">
              {[
                { key: "L7", label: tr("panel.layer7") },
                { key: "L4", label: tr("panel.layer4") },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => switchLayer(item.key)}
                  className={`w-full rounded-xl border px-4 py-2.5 text-sm font-semibold transition shadow sm:w-auto sm:flex-1 md:flex-none md:min-w-[110px] md:max-w-[130px] ${
                    form.layer === item.key
                      ? "border-red-500 bg-red-600 text-white"
                      : theme === "dark"
                        ? "border-slate-700 bg-slate-900 text-slate-200 hover:border-red-500/60"
                        : "border-slate-200 bg-white text-slate-700 hover:border-red-500/60"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="relative space-y-1" ref={methodRef}>
              <label className={labelClass}>{tr("panel.method")}</label>
              <button
                type="button"
                onClick={() => setMethodOpen((v) => !v)}
                className={[
                  "flex w-full items-center justify-between gap-2 rounded-none border px-3 py-2 text-sm font-semibold transition",
                  theme === "dark"
                    ? "border-slate-600 bg-slate-800/80 text-slate-100 shadow-inner shadow-slate-900/30 hover:border-red-500"
                    : "border-slate-300 bg-gradient-to-r from-slate-50 to-white text-slate-900 shadow hover:border-red-500",
                ].join(" ")}
                style={methodStyle}
              >
                <span className="flex-1 text-center">
                  {methods.find((m) => String(m.id) === form.method)?.display_name || tr("panel.selectMethod")}
                </span>
                <span
                  className={`rounded-none px-1 text-xs font-semibold ${
                    theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-slate-200 text-slate-800"
                  }`}
                  style={selectedColor ? { backgroundColor: `${selectedColor}33`, borderColor: selectedColor } : {}}
                >
                  ▼
                </span>
              </button>
              {methodOpen && (
                <div
                  className={[
                    "absolute z-10 mt-2 w-full overflow-hidden rounded-none border shadow-lg p-2",
                    theme === "dark"
                      ? "border-slate-700 bg-slate-800 text-slate-100"
                      : "border-slate-200 bg-white text-slate-900",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "px-1 py-1 text-[11px] font-semibold uppercase tracking-wide",
                      theme === "dark" ? "text-red-200" : "text-red-700",
                    ].join(" ")}
                  >
                    {form.layer === "L7" ? "HTTP" : "Socket"}
                  </div>
                  {methods
                    .filter((m) => m.layer === form.layer)
                    .map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onChange("method", String(m.id));
                          setMethodOpen(false);
                        }}
                        className={[
                          "w-full px-3 py-2 text-left text-sm font-semibold transition mb-1 last:mb-0",
                          theme === "dark"
                            ? "bg-slate-800 text-slate-100 hover:bg-slate-700"
                            : "bg-white text-slate-900 hover:bg-slate-100",
                          form.method === String(m.id)
                            ? "ring-1 ring-red-400/60"
                            : "",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <span
                              className="inline-flex h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: colorForId(m.id) }}
                            />
                            {m.display_name}
                          </span>
                          <span className="text-[11px] uppercase tracking-wide text-red-300">
                            {m.layer}
                          </span>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className={labelClass}>{form.layer === "L7" ? tr("panel.targetUrl") : tr("panel.targetHost")}</label>
                <input
                  value={form.host}
                  onChange={(e) => onChange("host", e.target.value)}
                  className={inputClass}
                  placeholder={form.layer === "L7" ? "https://example.com" : "1.1.1.1"}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>{tr("panel.time")}</label>
                <input
                  type="number"
                  min={1}
                  max={3600}
                  value={form.time}
                  onChange={(e) => onChange("time", e.target.value)}
                  className={inputClass}
                  placeholder="60"
                />
              </div>
            </div>

            {form.layer === "L7" ? null : (
              <div className="space-y-1">
                <label className={labelClass}>{tr("panel.port")}</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(e) => onChange("port", e.target.value)}
                  className={inputClass}
                  placeholder="443"
                />
              </div>
            )}

            <div className="space-y-1">
              <label className={labelClass}>
                {tr("panel.concurrent")}:{" "}
                <span className="font-bold">{form.concurrent}</span>
                {maxConc > 0 && (
                  <span className="text-xs text-slate-400 ml-2">
                    ({tr("panel.hints.concurrentMax")}: {maxConc})
                  </span>
                )}
              </label>
              <div>
                <div className="relative">
                  <input
                    type="range"
                    min={maxConc > 0 ? 1 : 0}
                    max={maxConc}
                    value={form.concurrent}
                    onChange={(e) => onChange("concurrent", Number(e.target.value))}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full accent-transparent"
                    style={{
                      background: `linear-gradient(90deg, #e45757 0%, #c84646 ${progress * 100}%, transparent ${progress * 100}%, transparent 100%)`,
                      boxShadow: "none",
                      border: "none",
                    }}
                  />
                    <style>{`
                      input[type="range"] {
                        outline: none;
                      }
                      input[type="range"]::-webkit-slider-runnable-track {
                        background: transparent;
                        border: none;
                        box-shadow: none;
                        height: 6px;
                        border-radius: 9999px;
                      }
                      input[type="range"]::-moz-range-track {
                        background: transparent;
                        border: none;
                        box-shadow: none;
                        height: 6px;
                        border-radius: 9999px;
                      }
                      input[type="range"]::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        appearance: none;
                        width: 14px;
                        height: 14px;
                        border-radius: 9999px;
                        border: 0;
                        background: #ffffff;
                        box-shadow: none;
                        margin-top: -4px;
                      }
                      input[type="range"]::-moz-range-thumb {
                        width: 14px;
                        height: 14px;
                        border-radius: 9999px;
                        border: 0;
                        background: #ffffff;
                        box-shadow: none;
                        margin-top: -4px;
                      }
                    `}</style>
                </div>
              </div>
            </div>

            {selectedMethod && (selectedMethod.params || []).length > 0 && (
              <div className="rounded-lg border border-slate-700/60 bg-slate-800/60">
                <button
                  type="button"
                  onClick={() => setShowAdvancedParams((v) => !v)}
                  className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-red-300"
                >
                  <span>{tr("panel.hints.advanced")}</span>
                  <span className="text-[11px]">{showAdvancedParams ? "▲" : "▼"}</span>
                </button>
                {showAdvancedParams && (
                  <div className="space-y-3 p-3">
                    {(selectedMethod.params || []).map((p) => {
                      const key = p.param_key || p.key;
                      const val = advancedValues[key] ?? "";
                      const commonProps = {
                        className: inputClass,
                        value: val,
                        onChange: (e) =>
                          setAdvancedValues((prev) => ({
                            ...prev,
                            [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
                          })),
                        placeholder: p.placeholder || "",
                      };
                      const title = p.label || key;
                      return (
                        <div key={key} className="space-y-1">
                          <label className={labelClass}>
                            {title} {p.required ? "*" : ""}
                            {p.default_value ? (
                              <span className="ml-2 text-[11px] text-slate-400">
                                ({tr("panel.hints.default")}: {p.default_value})
                              </span>
                            ) : null}
                          </label>
                          {p.type === "select" ? (
                            <select {...commonProps}>
                              <option value="">{tr("panel.hints.select")}</option>
                              {(p.options || "")
                                .split(",")
                                .map((opt) => opt.trim())
                                .filter(Boolean)
                                .map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                            </select>
                          ) : p.type === "checkbox" ? (
                            <label className="flex items-center gap-2 text-sm text-slate-200">
                              <input
                                type="checkbox"
                                checked={Boolean(val)}
                                onChange={(e) =>
                                  setAdvancedValues((prev) => ({ ...prev, [key]: e.target.checked }))
                                }
                                className="h-4 w-4 accent-red-500"
                              />
                              {p.placeholder || tr("panel.hints.enable")}
                            </label>
                          ) : (
                            <input type={p.type === "number" ? "number" : "text"} {...commonProps} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {showSchedule && (
              <div className="space-y-1">
                <label className={labelClass}>{tr("panel.hints.scheduleAt")}</label>
                <input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className={inputClass}
                />
                <p className="text-xs text-slate-400">
                  {tr("panel.hints.scheduleInfo")}
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              >
                {tr("panel.run")}
              </button>
            </div>
          </form>
        </div>
      </div>

      <OngoingCard
        theme={theme}
        cardClass={cardClass}
        token={token}
        apiUrl={apiUrl}
        onNotify={onNotify}
        isEditing={isEditing}
        refreshKey={ongoingRefreshKey}
        lang={lang}
        t={t}
      />
    </div>
  );
};

export default PanelPage;

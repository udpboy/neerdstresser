import { useCallback, useEffect, useRef, useState } from "react";
import { LightningBoltIcon, GlobeIcon, PersonIcon, ActivityLogIcon } from "@radix-ui/react-icons";

const DashboardPage = ({ theme, cardClass, apiUrl, token, lang, t }) => {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({ running: 0, total: 0 });
  const [userStats, setUserStats] = useState({ total: 0, online: 0 });
  const [plan, setPlan] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [usage, setUsage] = useState({ labels: [], methods: [] });
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [usageError, setUsageError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  const loadNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/news`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal memuat berita");
      setNews(data.news || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/panel/stats`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal memuat statistik");
      setStats({ running: data.running || 0, total: data.total || 0 });
    } catch {
      // ignore stats errors
    }
  }, [apiUrl]);

  const loadUserStats = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/stats/users`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal memuat statistik");
      setUserStats({ total: data.total || 0, online: data.online || 0 });
    } catch {
      // ignore stats errors
    }
  }, [apiUrl]);

  const loadPlan = useCallback(async () => {
    if (!token) {
      setPlan(null);
      return;
    }
    setLoadingPlan(true);
    try {
      const res = await fetch(`${apiUrl}/api/plan/me`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal memuat plan");
      setPlan(data.plan || null);
    } catch {
      setPlan(null);
    } finally {
      setLoadingPlan(false);
    }
  }, [apiUrl, token]);

  const loadUsage = useCallback(async () => {
    setLoadingUsage(true);
    setUsageError(null);
    try {
      const res = await fetch(`${apiUrl}/api/stats/method-usage`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal memuat statistik method");
      const labels = data.labels || [];
      const methods = (data.methods || []).map((m) => ({
        ...m,
        total: (m.series || []).reduce((a, b) => a + b, 0),
      }));
      setUsage({ labels, methods });
    } catch (err) {
      setUsageError(err.message);
    } finally {
      setLoadingUsage(false);
    }
  }, [apiUrl]);

  const refreshAll = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    await Promise.all([loadNews(), loadStats(), loadUserStats(), loadUsage(), loadPlan()]);
    refreshingRef.current = false;
    setRefreshing(false);
  }, [loadNews, loadStats, loadUserStats, loadUsage, loadPlan]);

  const dashboardLoadedRef = useRef(false);
  useEffect(() => {
    if (dashboardLoadedRef.current) return;
    dashboardLoadedRef.current = true;
    refreshAll();
  }, [refreshAll]);

  const tr = (key) => t(lang, key);

  const StatCard = ({ label, value, Icon }) => (
    <div
      className={`rounded-xl border px-4 py-3 shadow-sm ${
        theme === "dark"
          ? "border-slate-700 bg-slate-800 text-slate-100"
          : "border-slate-200 bg-white text-slate-900"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div
            className={`text-xs uppercase tracking-wide ${
              theme === "dark" ? "text-slate-400" : "text-slate-500"
            }`}
          >
            {label}
          </div>
          <div className="mt-2 text-2xl font-semibold">{value}</div>
        </div>
        {Icon && (
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-full ${
              theme === "dark" ? "bg-red-500/15 text-red-200" : "bg-red-100 text-red-700"
            }`}
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
          </span>
        )}
      </div>
    </div>
  );

  const Sparkline = ({ series, color, labels }) => {
    const [hoverIdx, setHoverIdx] = useState(null);
    if (!series || series.length === 0) {
      return <div className="h-24 w-full" />;
    }
    const maxRaw = Math.max(...series, 1);
    const max = maxRaw * 1.15; // add headroom to visually "zoom out"
    const points = series.map((v, idx) => {
      const x = (idx / Math.max(series.length - 1, 1)) * 100;
      const y = 100 - (v / max) * 100;
      return { x, y, v };
    });
    const buildSmoothPath = (pts) => {
      if (!pts.length) return "";
      if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
      const d = [`M ${pts[0].x},${pts[0].y}`];
      const smoothFactor = 10; // higher = softer curves
      for (let i = 0; i < pts.length - 1; i += 1) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        const cp1x = p1.x + (p2.x - p0.x) / smoothFactor;
        const cp1y = p1.y + (p2.y - p0.y) / smoothFactor;
        const cp2x = p2.x - (p3.x - p1.x) / smoothFactor;
        const cp2y = p2.y - (p3.y - p1.y) / smoothFactor;
        d.push(`C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`);
      }
      return d.join(" ");
    };
    const linePath = buildSmoothPath(points);
    const areaPath = `${linePath} L 100,100 L 0,100 Z`;
    const gradientId = `sparkgrad-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

    const handleMove = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const xPct = ((e.clientX - rect.left) / rect.width) * 100;
      let nearest = { dist: Infinity, idx: null };
      points.forEach((p, idx) => {
        const dist = Math.abs(p.x - xPct);
        if (dist < nearest.dist) nearest = { dist, idx };
      });
      setHoverIdx(nearest.idx);
    };

    const active = hoverIdx != null ? points[hoverIdx] : null;

    return (
      <div className="relative h-24 w-full">
        <svg
          viewBox="0 0 100 100"
          className="h-full w-full"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path fill={`url(#${gradientId})`} stroke="none" d={areaPath} />
          <path
            fill="none"
            stroke={color}
            strokeWidth="0.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            d={linePath}
          />
          {points.map((p, idx) => (
            <circle
              key={idx}
              cx={p.x}
              cy={p.y}
              r={hoverIdx === idx ? 1.6 : 1}
              fill={color}
              opacity={hoverIdx === idx ? 1 : 0.8}
            />
          ))}
          <rect
            x="0"
            y="0"
            width="100"
            height="100"
            fill="transparent"
            onMouseMove={handleMove}
          />
        </svg>
        {active && (
          <div
            className="pointer-events-none absolute rounded-lg bg-slate-900 px-2 py-1 text-xs text-slate-100 shadow-lg ring-1 ring-slate-700/60"
            style={{
              left: `${active.x}%`,
              top: `${active.y}%`,
              transform: "translate(-50%, -120%)",
              minWidth: "90px",
            }}
          >
            <div className="font-semibold">{active.v}</div>
            {labels?.[hoverIdx] && <div className="text-[10px] text-slate-300">{labels[hoverIdx]}</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={refreshAll}
          disabled={refreshing}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
            theme === "dark"
              ? "border-slate-700 bg-slate-800 text-slate-100 hover:border-red-500/60"
              : "border-slate-200 bg-white text-slate-800 hover:border-red-500/60"
          } ${refreshing ? "opacity-60 cursor-not-allowed" : ""}`}
        >
          {refreshing ? tr("common.loading") : tr("common.refresh")}
        </button>
      </div>
      <div className="grid w-full grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard label={tr("dashboard.stats.totalUsers")} value={userStats.total} Icon={PersonIcon} />
        <StatCard label={tr("dashboard.stats.onlineUsers")} value={userStats.online} Icon={LightningBoltIcon} />
        <StatCard label={tr("dashboard.stats.running")} value={stats.running} Icon={ActivityLogIcon} />
        <StatCard label={tr("dashboard.stats.total")} value={stats.total} Icon={GlobeIcon} />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <div className={`${cardClass(theme)} w-full lg:col-span-3`}>
          <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
            <div className="text-lg font-semibold title-dot">{tr("dashboard.newsTitle")}</div>
            <span className="text-xs uppercase tracking-wide text-red-300">{tr("dashboard.newsBadge")}</span>
          </div>
          <div className="px-5 py-4 sm:px-6">
            {loading && <div className="text-sm text-slate-400">{tr("dashboard.newsLoading")}</div>}
            {error && (
              <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}
            {!loading && !error && (
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {news.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-700/50 bg-slate-800 px-4 py-3 text-sm text-slate-100"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-base font-semibold">{item.title}</div>
                      <span className="text-[11px] uppercase tracking-wide text-slate-400">
                        {item.createdAt?.slice(0, 10) || ""}
                      </span>
                    </div>
                    <div
                      className="mt-2 text-slate-300 prose prose-invert prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: item.content }}
                    />
                  </div>
                ))}
                {news.length === 0 && (
                  <div className="rounded-lg border border-slate-700/50 bg-slate-800 px-4 py-3 text-sm text-slate-300">
                    {tr("dashboard.noNews")}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className={`${cardClass(theme)} w-full`}>
          <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
            <div className="text-lg font-semibold title-dot">{tr("dashboard.planTitle")}</div>
            <span className="text-xs uppercase tracking-wide text-red-300">{tr("common.status")}</span>
          </div>
          <div className="px-5 py-4 sm:px-6 text-sm">
            {loadingPlan && <div className="text-slate-400">{tr("common.loading")}</div>}
            {!loadingPlan && plan && (
              <div className="space-y-3">
                <div className="text-lg font-semibold text-slate-100">{plan.name}</div>
                {plan.displayHtml ? (
                  <div
                    className="rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-2 text-slate-200"
                    dangerouslySetInnerHTML={{ __html: plan.displayHtml }}
                  />
                ) : null}
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                  <div className="rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">{tr("dashboard.plan.maxConc")}</div>
                    <div className="text-sm font-semibold">{plan.maxConcurrent}</div>
                  </div>
                  <div className="rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">{tr("dashboard.plan.maxTime")}</div>
                    <div className="text-sm font-semibold">{plan.maxTime}s</div>
                  </div>
                  <div className="rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">{tr("dashboard.plan.access")}</div>
                    <div className="text-sm font-semibold">{plan.premiumAccess ? tr("dashboard.plan.premium") : tr("dashboard.plan.basic")}</div>
                  </div>
                  <div className="rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">{tr("dashboard.plan.api")}</div>
                    <div className="text-sm font-semibold">{plan.apiAccess ? tr("dashboard.plan.apiAvailable") : tr("dashboard.plan.apiUnavailable")}</div>
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  {tr("dashboard.plan.expire")}:{" "}
                  <span className="font-semibold text-slate-100">
                    {plan.expiresAt ? new Date(plan.expiresAt).toLocaleString() : tr("dashboard.plan.lifetime")}
                  </span>
                </div>
              </div>
            )}
            {!loadingPlan && !plan && (
              <div className="rounded-xl border border-slate-700/50 bg-slate-800 px-4 py-3 text-sm text-slate-100 space-y-2">
                <div className="text-base font-semibold">{tr("dashboard.plan.emptyTitle")}</div>
                <div className="text-slate-300">{tr("dashboard.plan.emptyDesc")}</div>
                <a
                  className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
                  href="/plans"
                >
                  {tr("dashboard.plan.cta")}
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {loadingUsage && <div className="text-sm text-slate-400">{tr("common.loading")}</div>}
        {usageError && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {usageError}
          </div>
        )}
        {!loadingUsage && !usageError && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {usage.methods.map((m) => {
              const palette = ["#e45757", "#ee7f7f", "#c84646", "#f4a6a6", "#a33838", "#7f2c2c"];
              const color = palette[m.id % palette.length];
              const totalSend = m.total ?? (m.series || []).reduce((a, b) => a + b, 0);
              const serverCount = m.serverCount ?? m.server_count ?? 1;
              return (
                <div key={m.id} className={`${cardClass(theme)} w-full min-h-[180px] flex flex-col`}>
                  <div className="flex items-center justify-between px-3 py-2 bg-transparent">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: color }} aria-hidden="true" />
                      <div className={`text-sm font-semibold ${theme === "dark" ? "text-slate-100" : "text-slate-800"}`}>
                        {m.displayName || m.name}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-semibold">
                      <div
                        className={`rounded-lg border px-2.5 py-1 leading-tight ${
                          theme === "dark" ? "border-slate-700 bg-transparent text-slate-100" : "border-slate-200 bg-transparent text-slate-800"
                        }`}
                      >
                        <div className="uppercase tracking-wide text-[10px] text-red-300">Total</div>
                        <div>{totalSend}</div>
                      </div>
                      <div
                        className={`rounded-lg border px-2.5 py-1 leading-tight ${
                          theme === "dark" ? "border-slate-700 bg-transparent text-slate-100" : "border-slate-200 bg-transparent text-slate-800"
                        }`}
                      >
                        <div className="uppercase tracking-wide text-[10px] text-red-300">Server</div>
                        <div>{serverCount}</div>
                      </div>
                    </div>
                  </div>
                    <div className="flex-1 px-1 pt-1 pb-3 sm:px-2">
                      <div className="h-full flex flex-col justify-center">
                        <div className="flex-1 min-h-[110px] -mx-1 sm:-mx-1.5">
                        <Sparkline series={m.series || []} color={color} labels={usage.labels} />
                        </div>
                        <div className="mt-3 flex justify-between text-[10px] uppercase tracking-wide text-slate-500/70">
                          <span className="bg-transparent">{usage.labels[0] || ""}</span>
                        <span className="bg-transparent">{usage.labels[usage.labels.length - 1] || ""}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {usage.methods.length === 0 && (
              <div className={`${cardClass(theme)} w-full px-4 py-3 text-sm ${theme === "dark" ? "text-slate-300" : "text-slate-600"}`}>
                {tr("dashboard.usageEmpty")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;

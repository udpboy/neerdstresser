import { useEffect, useRef, useState } from "react";

const PlansPage = ({ theme, cardClass, apiUrl, token, onNotify, lang, t }) => {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const palette = ["#e45757", "#c84646", "#ee7f7f", "#a33838", "#f4a6a6", "#7f2c2c", "#f9caca", "#5e1f1f"];
  const colorForId = (id) => palette[Math.abs(id) % palette.length];
  const [balance, setBalance] = useState(null);
  const [buyingId, setBuyingId] = useState(null);
  const fetchedPlansRef = useRef(false);
  const fetchedBalanceRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      if (fetchedPlansRef.current) {
        setLoading(false);
        return;
      }
      fetchedPlansRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiUrl}/api/plans`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || "Gagal memuat plan");
        setPlans(data.plans || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [apiUrl]);

  useEffect(() => {
    const loadBalance = async () => {
      if (fetchedBalanceRef.current === token) return;
      fetchedBalanceRef.current = token;
      if (!token) {
        setBalance(null);
        return;
      }
      try {
        const res = await fetch(`${apiUrl}/api/balance`, {
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || "Gagal memuat saldo");
        setBalance(data.balance ?? 0);
      } catch {
        setBalance(null);
      }
    };
    loadBalance();
  }, [apiUrl, token]);

  const buyPlan = async (id) => {
    if (!token) {
      onNotify?.("error", t(lang, "auth.login"));
      return;
    }
    setBuyingId(id);
    try {
      const res = await fetch(`${apiUrl}/api/plans/buy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ planId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Gagal membeli plan");
      onNotify?.("success", "Plan dibeli");
      if (data.balance !== undefined) setBalance(data.balance);
      setPlans((prev) =>
        prev.map((p) => (p.id === id ? { ...p, stock: Math.max(0, (p.stock || 0) - 1) } : p)),
      );
    } catch (err) {
      onNotify?.("error", err.message);
    } finally {
      setBuyingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1 sm:px-0">
        <div className="text-lg font-semibold title-dot">{t(lang, "plans.storeTitle")}</div>
        {balance !== null && (
          <span className="text-xs font-semibold uppercase tracking-wide text-emerald-200">
            {t(lang, "plans.balance")}: {balance}
          </span>
        )}
      </div>

      {loading && <div className="text-sm text-slate-400">{t(lang, "common.loading")}</div>}
      {error && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {plans.map((p) => {
            const outStock = p.stock <= 0;
            const price = p.final_price;
            const accent = colorForId(p.id);
            return (
              <div
                key={p.id}
                className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-800 shadow-xl"
                style={{ background: `linear-gradient(180deg, ${accent}1f 0%, #0b1224 45%, #0a1020 100%)` }}
              >
                <div
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ background: `linear-gradient(90deg, ${accent}, ${accent}aa)` }}
                />
                <div className="absolute inset-0 opacity-20" style={{ background: `radial-gradient(circle at 20% 20%, ${accent}, transparent 45%)` }} />

                <div className="relative px-6 py-7 space-y-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="rounded-full px-3 py-1 text-[11px] font-semibold text-slate-900"
                      style={{ background: `${accent}cc` }}
                    >
                      {t(lang, "plans.badgePlan")}
                    </div>
                    {p.discount ? (
                      <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-semibold text-emerald-100 border border-emerald-400/40">
                        -{p.discount}%
                      </span>
                    ) : null}
                    {outStock && (
                      <span className="rounded-full bg-red-500/20 px-3 py-1 text-[11px] font-semibold text-red-100 border border-red-400/40">
                        {t(lang, "plans.outOfStock")}
                      </span>
                    )}
                  </div>

                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-xl font-semibold text-slate-50">{p.name}</div>
                      <div
                        className="mt-2 rounded-lg border border-slate-700/60 bg-slate-800/70 px-3 py-2 text-sm text-slate-200"
                        dangerouslySetInnerHTML={{ __html: p.display_html }}
                      />
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-emerald-300 leading-tight">{price}</div>
                      {p.discount ? <div className="text-[11px] text-slate-500 line-through">{p.price}</div> : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                    <span className="rounded-full bg-slate-800/70 px-3 py-1 text-slate-200">
                      {p.premium_access ? t(lang, "plans.premium") : t(lang, "plans.basic")}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 ${
                        p.api_access ? "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30" : "bg-slate-700 text-slate-200 border border-slate-600"
                      }`}
                    >
                      API {p.api_access ? t(lang, "plans.apiAvailable") : t(lang, "plans.apiUnavailable")}
                    </span>
                    <span className="rounded-full bg-slate-800/70 px-3 py-1 text-slate-200 border border-slate-700/70">
                      {t(lang, "plans.stock")} {p.stock}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <div className="rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-slate-400">{t(lang, "plans.maxConcurrent")}</div>
                      <div className="text-sm font-semibold">{p.max_concurrent}</div>
                    </div>
                    <div className="rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-slate-400">{t(lang, "plans.maxTime")}</div>
                      <div className="text-sm font-semibold">{p.max_time}s</div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={outStock || buyingId === p.id}
                      onClick={() => buyPlan(p.id)}
                      className={`rounded-xl px-5 py-2 text-sm font-semibold transition ${
                        outStock
                          ? "cursor-not-allowed bg-slate-700 text-slate-400"
                          : "bg-red-600 text-white hover:bg-red-500"
                        }`}
                    >
                      {buyingId === p.id ? t(lang, "plans.processing") : t(lang, "plans.buyCta")}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {plans.length === 0 && (
            <div className={`${cardClass(theme)} w-full px-4 py-3 text-sm text-slate-300`}>{t(lang, "plans.noPlan")}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default PlansPage;

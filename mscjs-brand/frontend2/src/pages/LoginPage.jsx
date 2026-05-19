const inputClass = (theme) =>
  [
    "w-full rounded-lg border px-3 py-2 text-sm outline-none transition",
    theme === "dark"
      ? "bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
      : "bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-500 focus:border-red-500 focus:ring-2 focus:ring-red-400/30",
  ].join(" ");

const LoginPage = ({
  theme,
  accent,
  cardClass,
  loginForm,
  onLoginChange,
  onLoginSubmit,
  loading,
  captchaRequired,
  captcha,
  fetchCaptcha,
  navOpen,
  onSelectTab,
  lang,
  t,
}) => (
  <div className={`${cardClass(theme)} w-full max-w-2xl md:ml-0 md:mr-auto ${navOpen ? "sm:ml-64" : ""}`}>
    <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-full bg-red-600 px-3 py-1 text-sm font-semibold text-white"
          disabled
        >
          {t(lang, "auth.login")}
        </button>
        <button
          type="button"
          onClick={() => onSelectTab?.("register")}
          className="rounded-full px-3 py-1 text-sm font-semibold text-slate-400 hover:text-slate-100"
        >
          {t(lang, "auth.register")}
        </button>
      </div>
      <span className="text-xs uppercase tracking-wide text-slate-400">
        {t(lang, "auth.fillCredential")}
      </span>
    </div>

    <form onSubmit={onLoginSubmit} className="space-y-4 px-5 py-6 sm:px-6">
      <div className="space-y-2">
        <label className="text-sm text-slate-300">{t(lang, "auth.username")}</label>
        <input
          required
          value={loginForm.username}
          onChange={(e) =>
            onLoginChange({ ...loginForm, username: e.target.value })
          }
          className={inputClass(theme)}
          placeholder={t(lang, "auth.usernamePlaceholder")}
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm text-slate-300">{t(lang, "auth.password")}</label>
        <input
          type="password"
          required
          value={loginForm.password}
          onChange={(e) =>
            onLoginChange({ ...loginForm, password: e.target.value })
          }
          className={inputClass(theme)}
          placeholder={t(lang, "auth.passwordPlaceholder")}
        />
      </div>
      {captchaRequired && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm text-slate-300">{t(lang, "auth.captcha")}</label>
            <button
              type="button"
              onClick={fetchCaptcha}
              className="text-xs font-semibold text-red-400 hover:text-red-300"
            >
              {t(lang, "auth.refresh")}
            </button>
          </div>
          <div
            className={`flex items-center justify-center rounded-lg border px-3 py-2 text-sm ${theme === "dark" ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-slate-100 text-slate-900"}`}
          >
            {captcha?.image ? (
              <img
                src={captcha.image}
                alt="Captcha"
                className="h-14 w-full max-w-xs select-none rounded-md border border-slate-700/40 bg-slate-900/60 object-cover"
                draggable="false"
              />
            ) : (
              "Memuat captcha..."
            )}
          </div>
          <input
            required
            value={loginForm.captchaAnswer}
            onChange={(e) => onLoginChange({ ...loginForm, captchaAnswer: e.target.value })}
            className={inputClass(theme)}
            placeholder={t(lang, "auth.captchaPlaceholder")}
          />
          <div className="text-xs text-amber-300">Terlalu banyak percobaan. Isi captcha untuk lanjut.</div>
        </div>
      )}
      <button
        type="submit"
        disabled={loading}
        className={`${accent} w-full rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {loading ? t(lang, "auth.loading") : t(lang, "auth.submitLogin")}
      </button>
    </form>
  </div>
);

export default LoginPage;

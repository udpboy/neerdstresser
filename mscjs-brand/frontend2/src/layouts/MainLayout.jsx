import Alert from "../components/Alert";
import NavBar from "../components/NavBar";
import { t } from "../config/i18n";

const MainLayout = ({
  theme,
  backgroundClass,
  navOpen,
  onToggleNav,
  onCloseNav,
  onToggleTheme,
  activeTab,
  user,
  onSelectTab,
  onLogout,
  message,
  onCloseMessage,
  statsContent,
  children,
  brandName,
  brandLogo,
  lang,
  onLangChange,
  availableLangs = [],
}) => (
  <div className={`${backgroundClass} min-h-screen`}>
    <div className="mx-auto flex w-full max-w-5xl flex-col items-start justify-start gap-10 px-4 pb-14 pt-24 sm:px-6">
      <NavBar
        theme={theme}
        navOpen={navOpen}
        onToggleNav={onToggleNav}
        onCloseNav={onCloseNav}
        onToggleTheme={onToggleTheme}
        activeTab={activeTab}
        user={user}
        onSelectTab={onSelectTab}
        onLogout={onLogout}
        brandName={brandName}
        brandLogo={brandLogo}
        lang={lang}
      />

      {message && (
        <Alert
          theme={theme}
          type={message.type}
          text={message.text}
          onClose={onCloseMessage}
        />
      )}

      {statsContent}

      <div className="w-full">{children}</div>

      <footer
        className={`w-full pt-4 pb-6 mt-8 text-center text-xs ${
          theme === "dark" ? "text-slate-500" : "text-slate-600"
        }`}
      >
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-4">
          <span>© mscjs 2025-2026 - {typeof window !== "undefined" ? window.location.origin : ""}</span>
          {availableLangs.length > 0 && (
            <label className="flex items-center gap-2 text-[11px]">
              <span>{t(lang, "languageLabel")}</span>
              <select
                value={lang}
                onChange={(e) => onLangChange?.(e.target.value)}
                className={`rounded border px-2 py-1 text-xs ${
                  theme === "dark"
                    ? "border-slate-700 bg-slate-900 text-slate-100"
                    : "border-slate-300 bg-white text-slate-900"
                }`}
              >
                {availableLangs.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </footer>
    </div>
  </div>
);

export default MainLayout;

import { useState } from "react";
import ThemeSwitch from "./ThemeSwitch";
import { BRAND_NAME, BRAND_LOGO_URL } from "../config/constants";
import { t } from "../config/i18n";

const MenuContent = ({
  variant,
  theme,
  activeTab,
  user,
  onSelectTab,
  onCloseNav,
  onLogout,
  adminOpen,
  onToggleAdmin,
  inactiveButton,
  closeBtn,
  lang,
}) => (
  <div
    className={`${
      variant === "mobile"
        ? "fixed left-0 top-0 z-20 h-full w-64 sm:hidden"
        : "absolute left-0 top-14 z-20 hidden w-64 sm:block"
    } border-r px-4 py-6 transition-transform duration-200 sm:border sm:rounded-2xl sm:shadow-lg ${theme === "dark" ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white"}`}
  >
    <div className="flex items-center justify-between">
      <div className={`text-sm font-semibold ${theme === "dark" ? "text-slate-100" : "text-slate-800"}`}>{t(lang, "nav.menu")}</div>
      <button
        type="button"
        onClick={onCloseNav}
        className={`rounded-full px-2 text-xs font-semibold ${closeBtn}`}
      >
        Close
      </button>
    </div>
    <div className="mt-6 space-y-2 text-sm font-semibold">
      <button
        className={`w-full rounded-lg px-3 py-2 text-left transition ${activeTab === "dashboard" ? "bg-red-600 text-white" : inactiveButton}`}
        onClick={() => {
          onSelectTab("dashboard");
          onCloseNav();
        }}
        disabled={!user}
      >
        {t(lang, "nav.dashboard")}
      </button>
      <button
        className={`w-full rounded-lg px-3 py-2 text-left transition ${activeTab === "panel" ? "bg-red-600 text-white" : inactiveButton}`}
        onClick={() => {
          onSelectTab("panel");
          onCloseNav();
        }}
        disabled={!user}
      >
        {t(lang, "nav.panel")}
      </button>
      <button
        className={`w-full rounded-lg px-3 py-2 text-left transition ${activeTab === "manager" ? "bg-red-600 text-white" : inactiveButton}`}
        onClick={() => {
          onSelectTab("manager");
          onCloseNav();
        }}
        disabled={!user}
      >
        {t(lang, "nav.manager")}
      </button>
      <button
        className={`w-full rounded-lg px-3 py-2 text-left transition ${activeTab === "help" ? "bg-red-600 text-white" : inactiveButton}`}
        onClick={() => {
          onSelectTab("help");
          onCloseNav();
        }}
        disabled={!user}
      >
        {t(lang, "nav.help")}
      </button>
      <button
        className={`w-full rounded-lg px-3 py-2 text-left transition ${activeTab === "plans" ? "bg-red-600 text-white" : inactiveButton}`}
        onClick={() => {
          onSelectTab("plans");
          onCloseNav();
        }}
      >
        {t(lang, "nav.plans")}
      </button>
      {user?.isAdmin && (
        <div className="pt-1">
          <button
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${adminOpen ? "bg-red-600 text-white" : inactiveButton}`}
            onClick={onToggleAdmin}
            type="button"
          >
            <span>Admin</span>
            <span className="text-xs">{adminOpen ? "▾" : "▸"}</span>
          </button>
          {adminOpen && (
            <div
              className={`mt-2 space-y-2 border-l pl-3 ${
                theme === "dark" ? "border-slate-700/50" : "border-slate-200"
              }`}
            >
              <button
                className={`w-full rounded-lg px-3 py-2 text-left transition ${activeTab === "admin-users" ? "bg-red-600 text-white" : inactiveButton}`}
                onClick={() => {
                  onSelectTab("admin-users");
                  onCloseNav();
                }}
              >
                {t(lang, "nav.adminUsers")}
              </button>
              <button
                className={`w-full rounded-lg px-3 py-2 text-left transition ${activeTab === "admin-news" ? "bg-red-600 text-white" : inactiveButton}`}
                onClick={() => {
                  onSelectTab("admin-news");
                  onCloseNav();
                }}
              >
                {t(lang, "nav.adminNews")}
              </button>
              <button
                className={`w-full rounded-lg px-3 py-2 text-left transition ${activeTab === "admin-servers" ? "bg-red-600 text-white" : inactiveButton}`}
                onClick={() => {
                  onSelectTab("admin-servers");
                  onCloseNav();
                }}
              >
                {t(lang, "nav.adminServers")}
              </button>
              <button
                className={`w-full rounded-lg px-3 py-2 text-left transition ${activeTab === "admin-methods" ? "bg-red-600 text-white" : inactiveButton}`}
                onClick={() => {
                  onSelectTab("admin-methods");
                  onCloseNav();
                }}
              >
                {t(lang, "nav.adminMethods")}
              </button>
              <button
                className={`w-full rounded-lg px-3 py-2 text-left transition ${activeTab === "admin-balance-logs" ? "bg-red-600 text-white" : inactiveButton}`}
                onClick={() => {
                  onSelectTab("admin-balance-logs");
                  onCloseNav();
                }}
              >
                {t(lang, "nav.adminBalance")}
              </button>
              <button
                className={`w-full rounded-lg px-3 py-2 text-left transition ${activeTab === "admin-plans" ? "bg-red-600 text-white" : inactiveButton}`}
                onClick={() => {
                  onSelectTab("admin-plans");
                  onCloseNav();
                }}
              >
                {t(lang, "nav.adminPlans")}
              </button>
            </div>
          )}
        </div>
      )}
      <button
        className={`w-full rounded-lg px-3 py-2 text-left transition ${activeTab === "profile" ? "bg-red-600 text-white" : inactiveButton}`}
        onClick={() => {
          onSelectTab("profile");
          onCloseNav();
        }}
        disabled={!user}
      >
        {t(lang, "nav.profile")}
      </button>
      {user && (
        <button
          className={`w-full rounded-lg px-3 py-2 text-left transition hover:bg-red-500/10 ${theme === "dark" ? "text-red-200" : "text-red-700"}`}
          onClick={() => {
            onLogout();
            onCloseNav();
          }}
        >
          {t(lang, "nav.logout")}
        </button>
      )}
    </div>
  </div>
);

const NavBar = ({
  theme,
  navOpen,
  onToggleNav,
  onCloseNav,
  onToggleTheme,
  activeTab,
  user,
  onSelectTab,
  onLogout,
  brandName = BRAND_NAME,
  brandLogo = BRAND_LOGO_URL,
  lang = "en",
}) => {
  const [adminOpen, setAdminOpen] = useState(() => activeTab?.startsWith("admin"));
  const adminActive = activeTab?.startsWith("admin");
  const showAdminMenu = adminOpen || adminActive;

  const inactiveButton =
    theme === "dark"
      ? "text-slate-200 hover:bg-slate-800"
      : "text-slate-700 hover:bg-slate-100";

  const closeBtn =
    theme === "dark"
      ? "text-slate-400 hover:text-slate-200"
      : "text-slate-500 hover:text-slate-700";

  const menuProps = {
    theme,
    activeTab,
    user,
    onSelectTab,
    onCloseNav,
    onLogout,
    adminOpen: showAdminMenu,
    onToggleAdmin: () => setAdminOpen((v) => !v),
    inactiveButton,
    closeBtn,
    lang,
  };

  return (
    <>
      <nav
        className={`fixed left-0 right-0 top-0 z-20 w-full backdrop-blur ${theme === "dark" ? "bg-slate-900/90" : "bg-slate-50/90"}`}
      >
        <div className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Toggle navigation"
              onClick={onToggleNav}
              className={`flex h-11 w-11 items-center justify-center rounded-lg border transition ${theme === "dark" ? "border-slate-700 bg-slate-800 text-slate-100 hover:border-red-500/70" : "border-slate-200 bg-white text-slate-900 hover:border-red-400/70"}`}
            >
              <span className="flex flex-col items-center justify-center gap-1.5">
                <span className="block h-[2px] w-5 rounded-full bg-current" />
                <span className="block h-[2px] w-5 rounded-full bg-current" />
                <span className="block h-[2px] w-5 rounded-full bg-current" />
              </span>
            </button>
            <div className="flex items-center gap-2 leading-tight">
              {brandLogo ? (
                <img
                  src={brandLogo}
                  alt={brandName}
                  className="h-9 w-9 rounded-md border border-slate-700/50 bg-white object-contain"
                />
              ) : null}
              <div>
                <p className="text-sm font-semibold">{brandName}</p>
                <p className="text-[11px] text-slate-500">
                  {(
                    {
                      dashboard: "Dashboard",
                      panel: "Panel",
                      manager: "Manager",
                      plans: "Plans",
                      profile: "Profile",
                      help: "Help Desk",
                      "admin-users": "Admin Users",
                      "admin-news": "Admin News",
                      "admin-servers": "Admin Servers",
                      "admin-methods": "Admin Methods",
                      "admin-balance-logs": "Admin Balance Logs",
                      "admin-plans": "Admin Plans",
                    }[activeTab] || "Dashboard"
                  )}
                </p>
              </div>
            </div>
          </div>
          <ThemeSwitch
            theme={theme}
            onToggle={(checked) => onToggleTheme(checked ? "dark" : "light")}
          />

          {navOpen && <MenuContent variant="desktop" {...menuProps} />}
        </div>
      </nav>

      {navOpen && (
        <>
          <div
            className="fixed inset-0 z-10 bg-slate-900/60 backdrop-blur-sm sm:hidden"
            onClick={onCloseNav}
          />
          <MenuContent variant="mobile" {...menuProps} />
        </>
      )}
    </>
  );
};

export default NavBar;

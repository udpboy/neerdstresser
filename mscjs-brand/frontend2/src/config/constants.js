const fallbackOrigin =
  typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "http://localhost:4000";
export const API_URL = import.meta.env.VITE_API_URL || fallbackOrigin;
export const BRAND_NAME = import.meta.env.VITE_BRAND_NAME || "StresserCloud";
export const BRAND_LOGO_URL = import.meta.env.VITE_BRAND_LOGO_URL || "";
export const SERVER_HOST = import.meta.env.VITE_SERVER || "api-db.sakra.site";
export const DEFAULT_THEME =
  import.meta.env.VITE_DEFAULT_THEME === "light" ? "light" : "dark";

export const ACCENT_BUTTON = "bg-red-600 hover:bg-red-500 focus-visible:ring-red-400 text-white";

export const cardClass = (theme) =>
  [
    "rounded-2xl border shadow-lg",
    theme === "dark"
      ? "bg-slate-800 border-slate-700 shadow-red-900/10"
      : "bg-white border-slate-200 shadow-slate-200",
  ].join(" ");

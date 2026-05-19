import { useState } from "react";

const inputClass = (theme) =>
  [
    "w-full rounded-lg border px-3 py-2 text-sm outline-none transition",
    theme === "dark"
      ? "bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
      : "bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-500 focus:border-red-500 focus:ring-2 focus:ring-red-400/30",
  ].join(" ");

const ProfilePage = ({
  theme,
  cardClass,
  user,
  onSave,
  loading,
  form,
  onChange,
  resetForm,
  onResetChange,
  onResetSubmit,
  resetLoading,
  lang,
  t,
}) => {
  const labelClass =
    theme === "dark" ? "text-sm text-slate-300" : "text-sm text-slate-600";
  const subtleText =
    theme === "dark" ? "text-slate-400" : "text-slate-500";
  const tr = (key) => t(lang, key);
  const uniqueCode = user?.uniqueCode || user?.unique_code || "-";
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!uniqueCode || uniqueCode === "-") return;
    try {
      await navigator.clipboard.writeText(uniqueCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid w-full items-start gap-4 md:grid-cols-[1.2fr_0.8fr]">
      <div className={`${cardClass(theme)} w-full`}>
        <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
          <div>
            <div className="text-xs uppercase tracking-wide text-red-300">{tr("profile.title")}</div>
            <div className="text-lg font-semibold title-dot">
              {user?.username || tr("profile.username")}
            </div>
          </div>
          <span className={`text-xs uppercase tracking-wide ${subtleText}`}>
            {tr("profile.subtitle")}
          </span>
        </div>

        <form onSubmit={onSave} className="space-y-4 px-5 py-6 sm:px-6">
          <div className="space-y-2">
            <label className={labelClass}>{tr("profile.username")}</label>
            <input
              disabled
              value={form.username}
              className={`${inputClass(theme)} cursor-not-allowed opacity-70`}
            />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>{tr("profile.uniqueCode")}</label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                readOnly
                value={uniqueCode}
                className={`${inputClass(theme)} font-mono`}
              />
              <button
                type="button"
                onClick={handleCopy}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
                  theme === "dark"
                    ? "border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700"
                    : "border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200"
                }`}
              >
                {copied ? tr("common.copied") : tr("common.copy")}
              </button>
            </div>
            <p className={`text-xs ${subtleText}`}>{tr("profile.uniqueCodeHint")}</p>
          </div>
          <div className="space-y-2">
            <label className={labelClass}>{tr("profile.telegram")}</label>
            <input
              type="text"
              value={form.telegramId}
              onChange={(e) => onChange({ ...form, telegramId: e.target.value })}
              className={inputClass(theme)}
              placeholder={tr("profile.telegramPlaceholder")}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? tr("profile.saving") : tr("profile.save")}
          </button>
        </form>
      </div>

      <div className={`${cardClass(theme)} w-full self-start`}>
        <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4 sm:px-6">
          <div className="text-lg font-semibold title-dot">{tr("profile.resetTitle")}</div>
          <span className={`text-xs uppercase tracking-wide ${subtleText}`}>
            {tr("profile.security")}
          </span>
        </div>

        <form onSubmit={onResetSubmit} className="space-y-4 px-5 py-6 sm:px-6">
          <div className="space-y-2">
            <label className={labelClass}>{tr("profile.oldPassword")}</label>
            <input
              type="password"
              required
              value={resetForm.oldPassword}
              onChange={(e) => onResetChange({ ...resetForm, oldPassword: e.target.value })}
              className={inputClass(theme)}
              placeholder={tr("profile.oldPasswordPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>{tr("profile.newPassword")}</label>
            <input
              type="password"
              required
              value={resetForm.newPassword}
              onChange={(e) => onResetChange({ ...resetForm, newPassword: e.target.value })}
              className={inputClass(theme)}
              placeholder={tr("profile.newPasswordPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>{tr("profile.confirmNewPassword")}</label>
            <input
              type="password"
              required
              value={resetForm.confirmPassword}
              onChange={(e) => onResetChange({ ...resetForm, confirmPassword: e.target.value })}
              className={inputClass(theme)}
              placeholder={tr("profile.confirmNewPlaceholder")}
            />
          </div>
          <button
            type="submit"
            disabled={resetLoading}
            className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resetLoading ? tr("profile.processing") : tr("profile.reset")}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ProfilePage;

import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

const ConfirmDialog = ({
  open,
  theme = "dark",
  title = "Konfirmasi",
  message,
  confirmText = "Ya, lanjutkan",
  cancelText = "Batal",
  tone = "danger",
  loading = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  const base = theme === "dark"
    ? "bg-slate-900 border-slate-700 text-slate-100"
    : "bg-white border-slate-200 text-slate-900";

  const iconBox = tone === "danger"
    ? theme === "dark"
      ? "border-red-500/40 bg-red-500/10 text-red-200"
      : "border-red-200 bg-red-50 text-red-600"
    : theme === "dark"
      ? "border-red-500/40 bg-red-500/10 text-red-200"
      : "border-red-200 bg-red-50 text-red-700";

  const confirmBtn = tone === "danger"
    ? theme === "dark"
      ? "bg-red-600 hover:bg-red-500 focus:ring-red-500/60"
      : "bg-red-600 hover:bg-red-500 focus:ring-red-500/30"
    : theme === "dark"
      ? "bg-red-600 hover:bg-red-500 focus:ring-red-500/60"
      : "bg-red-600 hover:bg-red-500 focus:ring-red-500/30";

  const textMuted = theme === "dark" ? "text-slate-300" : "text-slate-700";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/70 px-4 backdrop-blur-sm">
      <div className={`w-full max-w-md rounded-2xl border shadow-2xl ${base}`}>
        <div className="flex items-start gap-3 px-5 py-4 sm:px-6">
          <div className={`mt-0.5 flex h-12 w-12 items-center justify-center rounded-xl border ${iconBox}`}>
            <ExclamationTriangleIcon className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="text-base font-semibold leading-tight">{title}</div>
            {message ? <p className={`text-sm leading-relaxed ${textMuted}`}>{message}</p> : null}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-800/50 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/40"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${confirmBtn}`}
          >
            {loading ? "Memproses..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;

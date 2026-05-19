import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";

const Alert = ({ theme, type, text, onClose }) => {
  const Icon = type === "error" ? CrossCircledIcon : CheckCircledIcon;
  const styles =
    type === "error"
      ? theme === "dark"
        ? "border-red-500/60 bg-red-500/10 text-red-100"
        : "border-red-600/60 bg-red-50 text-red-800"
      : theme === "dark"
        ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-100"
        : "border-emerald-600/60 bg-emerald-50 text-emerald-800";

  return (
    <div
      role="alert"
      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm ${styles}`}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-current" aria-hidden="true" />
      <div className="flex-1 leading-relaxed">{text}</div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-full px-2 text-xs font-semibold transition hover:opacity-80"
      >
        ✕
      </button>
    </div>
  );
};

export default Alert;

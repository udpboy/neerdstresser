import { PersonIcon, LightningBoltIcon } from "@radix-ui/react-icons";

const StatCard = ({ label, value, theme, Icon }) => (
  <div
    className={`rounded-xl border px-4 py-3 shadow-sm ${
      theme === "dark"
        ? "border-slate-700 bg-slate-800 text-slate-100"
        : "border-slate-200 bg-white text-slate-900"
    }`}
  >
    <div className="flex items-center justify-between">
      <div>
        <div className={`text-xs uppercase tracking-wide ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>
          {label}
        </div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
      </div>
      {Icon && (
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-full ${
            theme === "dark"
              ? "bg-red-500/15 text-red-200"
              : "bg-red-100 text-red-700"
          }`}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </span>
      )}
    </div>
  </div>
);

const StatsCards = ({ theme, totalUsers = 0, onlineUsers = 0 }) => (
  <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
    <StatCard label="Total User" value={totalUsers} theme={theme} Icon={PersonIcon} />
    <StatCard label="User Online" value={onlineUsers} theme={theme} Icon={LightningBoltIcon} />
  </div>
);

export default StatsCards;

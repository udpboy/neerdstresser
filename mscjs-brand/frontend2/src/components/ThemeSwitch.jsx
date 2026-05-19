import * as Switch from "@radix-ui/react-switch";
import { MoonIcon, SunIcon } from "@radix-ui/react-icons";

const ThemeSwitch = ({ theme, onToggle }) => {
  const isDark = theme === "dark";
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {isDark ? "Dark" : "Light"}
      </span>
      <Switch.Root
        checked={isDark}
        onCheckedChange={onToggle}
        className={`relative h-8 w-16 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${isDark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}
        aria-label="Toggle theme"
      >
        <Switch.Thumb
          className={`absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white shadow transition-transform ${isDark ? "translate-x-0" : "translate-x-8"}`}
        >
          {isDark ? (
            <MoonIcon className="h-4 w-4" aria-hidden="true" />
          ) : (
            <SunIcon className="h-4 w-4" aria-hidden="true" />
          )}
        </Switch.Thumb>
      </Switch.Root>
    </div>
  );
};

export default ThemeSwitch;

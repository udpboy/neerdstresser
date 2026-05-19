import { useEffect, useState } from "react";
import { DEFAULT_THEME } from "../config/constants";

const THEME_KEY = "theme";

const initialTheme = () => {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore
  }
  return DEFAULT_THEME;
};

export default function useTheme() {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  return { theme, setTheme };
}

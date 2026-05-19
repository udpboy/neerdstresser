import { useEffect, useState } from "react";

const LANG_KEY = "lang";
// Limit selector to 3 main languages for production UI
const SUPPORTED = ["id", "en", "zh"];

const initialLang = () => {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (SUPPORTED.includes(stored)) return stored;
  } catch {
    // ignore
  }
  return "id";
};

export default function useLanguage() {
  const [lang, setLang] = useState(initialLang);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // ignore
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  return { lang, setLang, supported: SUPPORTED };
}

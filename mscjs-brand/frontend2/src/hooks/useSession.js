import { useCallback, useState } from "react";

export default function useSession() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);

  const persistSession = useCallback((tokenValue, userValue) => {
    setToken(tokenValue);
    setUser(userValue);
  }, []);

  const clearSession = useCallback(() => {
    setToken("");
    setUser(null);
  }, []);

  return { token, user, persistSession, clearSession };
}

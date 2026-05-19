import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import ProfilePage from "./pages/ProfilePage";
import PanelPage from "./pages/PanelPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import AdminNewsPage from "./pages/AdminNewsPage";
import AdminMethodsPage from "./pages/AdminMethodsPage";
import AdminServersPage from "./pages/AdminServersPage";
import AdminPlansPage from "./pages/AdminPlansPage";
import AdminBalanceLogsPage from "./pages/AdminBalanceLogsPage";
import ManagerPage from "./pages/ManagerPage";
import PlansPage from "./pages/PlansPage";
import HelpDeskPage from "./pages/HelpDeskPage";
import AuthLayout from "./layouts/AuthLayout";
import MainLayout from "./layouts/MainLayout";
import useSession from "./hooks/useSession";
import useTheme from "./hooks/useTheme";
import { ACCENT_BUTTON, API_URL, BRAND_NAME, BRAND_LOGO_URL, cardClass } from "./config/constants";
import useLanguage from "./hooks/useLanguage";
import { t } from "./config/i18n";
import {
  fetchCaptcha as fetchCaptchaApi,
  fetchMe as fetchMeApi,
  loginUser,
  registerUser,
  resetPassword,
  logoutUser,
  updateProfile,
} from "./lib/api";

const ProtectedRoute = ({ user, children }) => {
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

const AdminRoute = ({ user, children }) => {
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isAdmin) return <Navigate to="/dashboard" replace />;
  return children;
};

function AppShell() {
  const { theme, setTheme } = useTheme();
  const { token, user, persistSession, clearSession } = useSession();
  const { lang, setLang, supported: supportedLangs } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [captcha, setCaptcha] = useState({ captchaId: "", image: "" });
  const [navOpen, setNavOpen] = useState(false);
  const unauthorizedRef = useRef(false);

  const [registerForm, setRegisterForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    captchaAnswer: "",
  });

  const [loginForm, setLoginForm] = useState({
    username: "",
    password: "",
    captchaAnswer: "",
  });
  const [loginCaptchaRequired, setLoginCaptchaRequired] = useState(false);

  const [profileForm, setProfileForm] = useState({
    username: user?.username || "",
    telegramId: user?.telegramId || "",
  });
  const [resetForm, setResetForm] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const meFetchedRef = useRef(false);

  const background = useMemo(
    () =>
      theme === "dark"
        ? "bg-slate-900 text-slate-100"
        : "bg-slate-50 text-slate-900",
    [theme],
  );

  const showMessage = useCallback((type, text) => setMessage({ type, text }), []);

  useEffect(() => {
    document.body.className = background;
  }, [background]);

  useEffect(() => {
    if (location.pathname === "/") {
      navigate("/login", { replace: true });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    if (user && (location.pathname === "/login" || location.pathname === "/register")) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, location.pathname, navigate]);

  useEffect(() => {
    if (!hydrated) return;
    if (!user && location.pathname !== "/login" && location.pathname !== "/register") {
      navigate("/login", { replace: true });
    }
  }, [user, location.pathname, navigate, hydrated]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(t);
  }, [message]);

  const fetchCaptcha = useCallback(async () => {
    try {
      const data = await fetchCaptchaApi();
      setCaptcha(data);
      setRegisterForm((prev) => ({ ...prev, captchaAnswer: "" }));
      setLoginForm((prev) => ({ ...prev, captchaAnswer: "" }));
    } catch (err) {
      showMessage("error", err.message);
    }
  }, [showMessage]);

  useEffect(() => {
    if (user) return;
    if (location.pathname !== "/login" && location.pathname !== "/register") return;
    fetchCaptcha();
  }, [fetchCaptcha, location.pathname, user]);

  const fetchMe = useCallback(async () => {
    try {
      const data = await fetchMeApi(token);
      if (data?.user) {
        persistSession(token || "cookie", data.user);
        setProfileForm({
          username: data.user.username,
          telegramId: data.user.telegramId || "",
        });
      }
    } catch {
      // ignore fetch errors
    }
  }, [persistSession, token]);

  useEffect(() => {
    if (location.pathname === "/login" || location.pathname === "/register") {
      setHydrated(true);
      return;
    }
    if (meFetchedRef.current) return;
    if (user) {
      meFetchedRef.current = true;
      setHydrated(true);
      return;
    }
    meFetchedRef.current = true;
    fetchMe()
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, [fetchMe, location.pathname, user]);

  const logout = useCallback(async () => {
    if (token) {
      try {
        await logoutUser(token);
      } catch {
        // ignore logout errors
      }
    }
    clearSession();
    navigate("/login", { replace: true });
    setProfileForm({ username: "", telegramId: "" });
    setResetForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
    setNavOpen(false);
  }, [clearSession, navigate, token]);

  useEffect(() => {
    const originalFetch = window.fetch;
    const wrappedFetch = async (...args) => {
      const res = await originalFetch(...args);
      if (res.status === 401 && !unauthorizedRef.current) {
        unauthorizedRef.current = true;
        showMessage("error", "Sesi kadaluarsa, silakan login ulang");
        logout();
        setTimeout(() => {
          unauthorizedRef.current = false;
        }, 500);
      }
      return res;
    };
    window.fetch = wrappedFetch;
    return () => {
      window.fetch = originalFetch;
    };
  }, [logout, showMessage]);

  useEffect(() => {
    if (user) {
      setProfileForm({
        username: user.username,
        telegramId: user.telegramId || "",
      });
    }
  }, [user]);

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!registerForm.username.trim() || !registerForm.password || !registerForm.confirmPassword) {
      showMessage("error", "Lengkapi semua field terlebih dahulu");
      return;
    }
    if (registerForm.username.trim().length < 3) {
      showMessage("error", "Username minimal 3 karakter");
      return;
    }
    if (registerForm.password.length < 8) {
      showMessage("error", "Password minimal 8 karakter");
      return;
    }
    if (registerForm.password !== registerForm.confirmPassword) {
      showMessage("error", "Password tidak sama");
      return;
    }
    if (!captcha.captchaId) {
      showMessage("error", "Captcha belum siap, silakan refresh");
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const data = await registerUser({
        ...registerForm,
        username: registerForm.username.trim(),
        captchaId: captcha.captchaId,
      });
      persistSession(data.token, data.user);
      setProfileForm({
        username: data.user.username,
        telegramId: data.user.telegramId || "",
      });
      setMessage({ type: "success", text: "Registrasi sukses. Langsung masuk." });
      setRegisterForm({
        username: "",
        password: "",
        confirmPassword: "",
        captchaAnswer: "",
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      showMessage("error", err.message);
      fetchCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!loginForm.username.trim() || !loginForm.password) {
      showMessage("error", "Username dan password wajib diisi");
      return;
    }
    if (loginCaptchaRequired && !captcha.captchaId) {
      showMessage("error", "Captcha belum siap, silakan refresh");
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const payload = {
        ...loginForm,
        username: loginForm.username.trim(),
      };
      if (loginCaptchaRequired) {
        payload.captchaId = captcha.captchaId;
      }
      const data = await loginUser(payload);
      persistSession(data.token, data.user);
      setProfileForm({
        username: data.user.username,
        telegramId: data.user.telegramId || "",
      });
      setMessage({ type: "success", text: "Login berhasil" });
      setLoginCaptchaRequired(false);
      setLoginForm((prev) => ({ ...prev, captchaAnswer: "" }));
      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (err.requireCaptcha) {
        setLoginCaptchaRequired(true);
        if (err.data?.captchaId && err.data?.captchaImage) {
          setCaptcha({ captchaId: err.data.captchaId, image: err.data.captchaImage });
          setLoginForm((prev) => ({ ...prev, captchaAnswer: "" }));
        } else {
          fetchCaptcha();
        }
      }
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const activeTab = useMemo(() => {
    if (location.pathname.startsWith("/admin/users")) return "admin-users";
    if (location.pathname.startsWith("/admin/news")) return "admin-news";
    if (location.pathname.startsWith("/admin/servers")) return "admin-servers";
    if (location.pathname.startsWith("/admin/methods")) return "admin-methods";
    if (location.pathname.startsWith("/admin/balance-logs")) return "admin-balance-logs";
    if (location.pathname.startsWith("/admin/plans")) return "admin-plans";
    if (location.pathname.startsWith("/help")) return "help";
    if (location.pathname.startsWith("/manager")) return "manager";
    if (location.pathname.startsWith("/plans")) return "plans";
    if (location.pathname.startsWith("/profile")) return "profile";
    if (location.pathname.startsWith("/panel")) return "panel";
    if (location.pathname.startsWith("/dashboard")) return "dashboard";
    if (location.pathname.startsWith("/register")) return "register";
    return "login";
  }, [location.pathname]);

  const handleProfileSave = async (e) => {
    e.preventDefault();
    try {
      const data = await updateProfile(token, {
        telegramId: profileForm.telegramId?.trim() || "",
      });
      const updatedUser = { ...user, telegramId: data.telegramId };
      persistSession(token, updatedUser);
      showMessage("success", "Profil disimpan");
    } catch (err) {
      showMessage("error", err.message);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (resetForm.newPassword !== resetForm.confirmPassword) {
      showMessage("error", "Password baru tidak sama");
      return;
    }
    if (resetForm.newPassword.length < 8) {
      showMessage("error", "Password baru minimal 8 karakter");
      return;
    }
    try {
      await resetPassword(token, resetForm);
      showMessage("success", "Password tersimpan");
      setResetForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      showMessage("error", err.message);
    }
  };

  const statsContent = null;

  useEffect(() => {
    const key =
      {
        dashboard: "dashboard",
        panel: "panel",
        manager: "manager",
        plans: "plans",
        profile: "profile",
        help: "help",
        "admin-users": "adminUsers",
        "admin-news": "adminNews",
        "admin-servers": "adminServers",
        "admin-methods": "adminMethods",
        "admin-balance-logs": "adminBalance",
        "admin-plans": "adminPlans",
      }[activeTab] || "dashboard";
    const pageLabel = t(lang, `nav.${key}`);
    document.title = `${pageLabel} | ${BRAND_NAME}`;
  }, [activeTab, lang]);

  const goToTab = (tab) => {
    switch (tab) {
      case "dashboard":
        navigate("/dashboard");
        break;
      case "panel":
        navigate("/panel");
        break;
      case "admin-methods":
        navigate("/admin/methods");
        break;
      case "admin-servers":
        navigate("/admin/servers");
        break;
      case "admin-users":
        navigate("/admin/users");
        break;
      case "admin-plans":
        navigate("/admin/plans");
        break;
      case "admin-balance-logs":
        navigate("/admin/balance-logs");
        break;
      case "manager":
        navigate("/manager");
        break;
      case "help":
        navigate("/help");
        break;
      case "plans":
        navigate("/plans");
        break;
      case "admin-news":
        navigate("/admin/news");
        break;
      case "profile":
        navigate("/profile");
        break;
      default:
        navigate("/dashboard");
    }
  };

  const ProtectedLayout = () => (
    <ProtectedRoute user={user}>
      <MainLayout
        theme={theme}
        backgroundClass={background}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onToggleTheme={(val) => setTheme(val)}
        activeTab={activeTab}
        user={user}
        onSelectTab={goToTab}
        onLogout={logout}
        message={message}
        onCloseMessage={() => setMessage(null)}
        statsContent={statsContent}
        brandName={BRAND_NAME}
        brandLogo={BRAND_LOGO_URL}
        lang={lang}
        onLangChange={setLang}
        availableLangs={supportedLangs}
      >
        <Outlet />
      </MainLayout>
    </ProtectedRoute>
  );

  const AdminLayout = () => (
    <AdminRoute user={user}>
      <MainLayout
        theme={theme}
        backgroundClass={background}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onToggleTheme={(val) => setTheme(val)}
        activeTab={activeTab}
        user={user}
        onSelectTab={goToTab}
        onLogout={logout}
        message={message}
        onCloseMessage={() => setMessage(null)}
        statsContent={statsContent}
        brandName={BRAND_NAME}
        brandLogo={BRAND_LOGO_URL}
        lang={lang}
        onLangChange={setLang}
        availableLangs={supportedLangs}
      >
        <Outlet />
      </MainLayout>
    </AdminRoute>
  );

  if (!user) {
    return (
      <AuthLayout
        theme={theme}
        backgroundClass={background}
        activeTab={activeTab}
        message={message}
        onCloseMessage={() => setMessage(null)}
        lang={lang}
        t={t}
        loginProps={{
          accent: ACCENT_BUTTON,
          cardClass,
          loginForm,
          onLoginChange: setLoginForm,
          onLoginSubmit: handleLogin,
          loading,
          captchaRequired: loginCaptchaRequired,
          captcha,
          fetchCaptcha,
          navOpen: false,
          onSelectTab: (tab) => navigate(tab === "register" ? "/register" : "/login"),
        }}
        registerProps={{
          accent: ACCENT_BUTTON,
          cardClass,
          registerForm,
          onRegisterChange: setRegisterForm,
          onRegisterSubmit: handleRegister,
          loading,
          captcha,
          fetchCaptcha,
          navOpen: false,
          onSelectTab: (tab) => navigate(tab === "login" ? "/login" : "/register"),
        }}
      />
    );
  }

  return (
    <Routes>
      <Route element={<ProtectedLayout />}>
        <Route
          path="/dashboard"
          element={
            <DashboardPage
              theme={theme}
              cardClass={cardClass}
              user={user}
              onLogout={logout}
              navOpen={navOpen}
              apiUrl={API_URL}
              token={token}
              lang={lang}
              t={t}
            />
          }
        />
        <Route
          path="/panel"
          element={
            <PanelPage
              theme={theme}
              cardClass={cardClass}
              token={token}
              apiUrl={API_URL}
              onNotify={showMessage}
              lang={lang}
              t={t}
            />
          }
        />
        <Route
          path="/manager"
          element={
            <ManagerPage
              theme={theme}
              cardClass={cardClass}
              apiUrl={API_URL}
              token={token}
              onNotify={(type, text) => showMessage(type, text)}
              lang={lang}
              t={t}
            />
          }
        />
        <Route
          path="/help"
          element={
            <HelpDeskPage
              theme={theme}
              cardClass={cardClass}
              apiUrl={API_URL}
              token={token}
              onNotify={(type, text) => showMessage(type, text)}
              lang={lang}
              t={t}
            />
          }
        />
        <Route
          path="/plans"
          element={
            <PlansPage
              theme={theme}
              cardClass={cardClass}
              apiUrl={API_URL}
              token={token}
              onNotify={showMessage}
              lang={lang}
              t={t}
            />
          }
        />
        <Route
          path="/profile"
          element={
            <ProfilePage
              theme={theme}
              cardClass={cardClass}
              user={user}
              onSave={handleProfileSave}
              loading={loading}
              form={profileForm}
              onChange={setProfileForm}
              resetForm={resetForm}
              onResetChange={setResetForm}
              onResetSubmit={handleResetPassword}
              resetLoading={loading}
              lang={lang}
              t={t}
            />
          }
        />
      </Route>
      <Route element={<AdminLayout />}>
        <Route
          path="/admin/users"
          element={
            <AdminUsersPage
              theme={theme}
              cardClass={cardClass}
              token={token}
              apiUrl={API_URL}
              onNotify={(type, text) => showMessage(type, text)}
              lang={lang}
              t={t}
            />
          }
        />
        <Route
          path="/admin/news"
          element={
            <AdminNewsPage
              theme={theme}
              cardClass={cardClass}
              token={token}
              apiUrl={API_URL}
              onNotify={(type, text) => showMessage(type, text)}
              lang={lang}
              t={t}
            />
          }
        />
        <Route
          path="/admin/methods"
          element={
            <AdminMethodsPage
              theme={theme}
              cardClass={cardClass}
              token={token}
              apiUrl={API_URL}
              onNotify={(type, text) => showMessage(type, text)}
              lang={lang}
              t={t}
            />
          }
        />
        <Route
          path="/admin/servers"
          element={
            <AdminServersPage
              theme={theme}
              cardClass={cardClass}
              token={token}
              apiUrl={API_URL}
              onNotify={(type, text) => showMessage(type, text)}
              lang={lang}
              t={t}
            />
          }
        />
        <Route
          path="/admin/plans"
          element={
            <AdminPlansPage
              theme={theme}
              cardClass={cardClass}
              token={token}
              apiUrl={API_URL}
              onNotify={(type, text) => showMessage(type, text)}
              lang={lang}
              t={t}
            />
          }
        />
        <Route
          path="/admin/balance-logs"
          element={
            <AdminBalanceLogsPage
              theme={theme}
              cardClass={cardClass}
              token={token}
              apiUrl={API_URL}
              onNotify={(type, text) => showMessage(type, text)}
              lang={lang}
              t={t}
            />
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AppShell />} />
        <Route path="/register" element={<AppShell />} />
        <Route path="/*" element={<AppShell />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

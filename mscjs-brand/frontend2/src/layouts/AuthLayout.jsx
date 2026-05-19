import Alert from "../components/Alert";
import LoginPage from "../pages/LoginPage";
import RegisterPage from "../pages/RegisterPage";

const AuthLayout = ({
  theme,
  backgroundClass,
  activeTab,
  message,
  onCloseMessage,
  loginProps,
  registerProps,
  lang,
  t,
}) => (
  <div className={`${backgroundClass} min-h-screen flex items-center justify-center px-4 py-10`}>
    <div className="w-full max-w-md space-y-4">
      {message && (
        <Alert
          theme={theme}
          type={message.type}
          text={message.text}
          onClose={onCloseMessage}
        />
      )}
      {activeTab === "login" && <LoginPage theme={theme} lang={lang} t={t} {...loginProps} />}
      {activeTab === "register" && (
        <RegisterPage theme={theme} lang={lang} t={t} {...registerProps} />
      )}
    </div>
  </div>
);

export default AuthLayout;

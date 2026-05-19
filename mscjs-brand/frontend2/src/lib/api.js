import { API_URL } from "../config/constants";

const parseJson = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const request = async (path, { method = "GET", body, token, headers = {} } = {}) => {
  const authHeaders =
    token && token !== "cookie" ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...authHeaders,
      ...headers,
    },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await parseJson(res);
  if (!res.ok) {
    const error = new Error(data?.message || "Permintaan gagal");
    error.status = res.status;
    error.data = data;
    if (data?.requireCaptcha) error.requireCaptcha = true;
    throw error;
  }
  return data;
};

export const fetchCaptcha = () => request("/api/captcha");

export const registerUser = (payload) =>
  request("/api/auth/register", { method: "POST", body: payload });

export const loginUser = (payload) =>
  request("/api/auth/login", { method: "POST", body: payload });

export const fetchMe = (token) => request("/api/auth/profile", { token });

export const updateProfile = (token, payload) =>
  request("/api/profile", { method: "PATCH", token, body: payload });

export const resetPassword = (token, payload) =>
  request("/api/auth/reset", { method: "POST", token, body: payload });

export const logoutUser = (token) =>
  request("/api/auth/logout", { method: "POST", token });

export { API_URL };

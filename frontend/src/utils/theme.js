const STORAGE_KEY = "sanopos_theme";

export function getTheme() {
  return localStorage.getItem(STORAGE_KEY) || "light";
}

export function setTheme(theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.dataset.theme = theme;
}

export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export function initTheme() {
  setTheme(getTheme());
}

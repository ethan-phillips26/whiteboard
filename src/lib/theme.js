// Light or dark. Light unless you have said otherwise — the machine's own
// setting is not consulted. The choice is a browser preference rather than
// server state: it belongs to the screen you are reading on, not the account.

const KEY = "theme";
export const THEMES = ["light", "dark"];

export function stored() {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function apply(choice) {
  const theme = choice === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // A browser with storage blocked still gets the theme for this session.
  }
}

// Demo mode: `?demo` in the address. The whole app runs as usual against a fake
// Blackboard (demo.js) and its own store, so a visitor can try it with no account
// and no extension, and nothing mixes with real data.

export const DEMO =
  typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");

/** Whether this is the iPhone app: the same page, bundled by Capacitor, which puts
 * `window.Capacitor` in place before any script runs. There the Blackboard plugin
 * (ios/App/App/BlackboardPlugin.swift) answers what the extension answers here. */
export const NATIVE =
  typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());

/** This page with demo mode switched on or off, back at the dashboard. */
export function modeUrl(on) {
  const url = new URL(location.href);
  if (on) url.searchParams.set("demo", "");
  else url.searchParams.delete("demo");
  url.hash = "";
  return url.toString().replace(/demo=(?=&|$)/, "demo");
}

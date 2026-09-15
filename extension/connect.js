const params = new URLSearchParams(location.search);
const host = document.getElementById("host");
const msg = document.getElementById("msg");

// Read ahead of the click: the permission prompt has to open while the click is
// still being handled, so nothing can be awaited between the two.
let fileHosts = [];
chrome.storage.local.get(["host", "fileHosts"]).then(({ host: saved, fileHosts: known }) => {
  host.value = params.get("host") || saved || "";
  fileHosts = known ?? [];
});

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let origin;
  try {
    origin = blackboardOrigin(host.value);
  } catch (err) {
    msg.textContent = err.message;
    return;
  }
  // Nothing may be awaited before this: the prompt is only allowed while the click
  // that asked for it is still being handled.
  const ok = await chrome.permissions.request({ origins: connectPatterns(origin, fileHosts) });
  if (!ok) {
    msg.textContent = "Not allowed — Whiteboard can't read Blackboard without this.";
    return;
  }
  await chrome.storage.local.set({ host: origin });
  msg.textContent = "Connected. You can close this tab.";
  // Opened by the dashboard, which is polling and will notice; go back to it.
  if (params.has("host")) setTimeout(() => window.close(), 800);
});

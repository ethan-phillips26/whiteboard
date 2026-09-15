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

// The tone is what the page colours the line by: "bad", "ok", or none.
function say(text, tone) {
  msg.textContent = text;
  if (tone) msg.dataset.tone = tone;
  else delete msg.dataset.tone;
}

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let origin;
  try {
    origin = blackboardOrigin(host.value);
  } catch (err) {
    say(err.message, "bad");
    return;
  }
  // Nothing may be awaited before this: the prompt is only allowed while the click
  // that asked for it is still being handled.
  const ok = await chrome.permissions.request({ origins: connectPatterns(origin, fileHosts) });
  if (!ok) {
    say("Not allowed — Whiteboard can't read Blackboard without this.", "bad");
    return;
  }
  await chrome.storage.local.set({ host: origin });
  say("Connected. You can close this tab.", "ok");
  // Opened by the dashboard, which is polling and will notice; go back to it.
  if (params.has("host")) setTimeout(() => window.close(), 800);
});

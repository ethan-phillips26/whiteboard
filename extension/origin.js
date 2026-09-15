// Shared by the worker (importScripts) and connect.html. Defined once so the host a
// person types on the connect page and the host the worker checks requests against
// can never disagree about a scheme or a trailing slash.

function blackboardOrigin(raw) {
  let s = String(raw || "").trim();
  if (!s) throw new Error("Enter your Blackboard address.");
  if (!/^[a-z]+:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  // A session cookie sent in the clear is one anybody on the network can reuse.
  if (u.protocol !== "https:") throw new Error("Blackboard has to be an https:// address.");
  return u.origin;
}

// The permission is asked for per host, not per origin: a match pattern with no
// port covers every port, and one with a port is refused by some browsers.
function hostPattern(origin) {
  const u = new URL(origin);
  return `${u.protocol}//${u.hostname}/*`;
}

// Blackboard's hosted Learn keeps course files off the Learn host, and its file
// links redirect there with a signed URL. Following that redirect from the extension
// needs permission for the storage host too, or the browser withholds the file like
// any other cross-site response. Most schools' files sit behind the CDN; some are on
// an `alt-<hash>.blackboard.com` host instead. Both are asked for up front, because
// learning the host from a refused download meant the first file anybody opened
// failed and "Allow access" had to be pressed a second time.
const FILE_STORAGE = [
  "https://*.content.blackboardcdn.com/*",
  "https://*.blackboard.com/*",
];

/** Everything connecting asks for, in one prompt: the Blackboard, and its files —
 * the known storage hosts, plus any other a refused download was found to
 * redirect to. */
function connectPatterns(origin, fileHosts = []) {
  return [hostPattern(origin), ...FILE_STORAGE, ...fileHosts];
}

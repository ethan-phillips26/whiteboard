# Whiteboard Connector (prototype)

A browser extension that lets a statically hosted Whiteboard page — GitHub Pages, no
server — read Blackboard using the session the person already has in their browser.

## Why an extension

A web page cannot read Blackboard itself:

- **CORS.** Blackboard answers `Access-Control-Allow-Origin: <its own origin>`, so the
  browser withholds every response from any other site.
- **Forbidden headers.** A page cannot set `Cookie`, so holding a copy of the session
  would not help it.

An extension with host permission for the Blackboard site is exempt from both: its
requests carry the person's cookies and CORS does not apply.

One more trap: **Blackboard 403s any request whose `Origin` is not its own**, including
`chrome-extension://…`. Chrome sends no `Origin` on an extension's GETs, so it never
comes up there. `background.js` still strips the header with a `declarativeNetRequest`
session rule, scoped to requests made outside any tab, as insurance for a browser that
does send it — that has not been measured in Firefox.

## How it fits together

```
dashboard page ──postMessage──▶ bridge.js ──runtime.sendMessage──▶ background.js ──GET──▶ Blackboard
 (renders)                     (content script)                  (the only gate)
```

- `background.js` is the only code that talks to Blackboard, and it only does `GET` under
  `/learn/api/public/` on the one host the person connected. Any other path, host or
  request type is refused — that is where the read-only rule is enforced.
- `bridge.js` relays for the page. Firefox has no `externally_connectable` for web
  pages, so a content script is the portable way in.
- `connect.html` asks for the host permission. A permission prompt has to come from a
  click on one of the extension's own pages, so the dashboard's Connect opens it.
- Sign-in is Blackboard's own front door in a normal tab. The worker checks `users/me`
  (a `BbRouter` alone proves nothing) and closes the tab once it answers.

## Trying it

1. `chrome://extensions` → Developer mode → **Load unpacked** → this directory.
2. Open <https://ethanphillips.dev/whiteboard/>, enter your Blackboard address, allow
   access, sign in.

The bridge is injected on that path and nowhere else — not the rest of
ethanphillips.dev, whose other Pages projects share its origin. To work against a
local build (`npm run dev:browser`), load a copy of this directory with
`http://localhost/*` added to the content script's `matches` and a matching entry in
`PAGES` in `background.js`. Never publish that copy: any page on the machine could
then read Blackboard through it.

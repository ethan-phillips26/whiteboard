# Whiteboard Connector

The browser extension that [Whiteboard](https://ethanphillips.dev/whiteboard/) needs to
read your Blackboard courses. Browsers don't let one website read another site's data,
so the extension fetches your courses, due dates, grades and files from Blackboard,
using the session already in your browser, and passes them to the Whiteboard page.

It only reads. It can't submit, post or change anything in Blackboard, and it only
works with the Whiteboard page. Nothing is sent anywhere else.

## Install

The extension isn't in any store yet, so it's installed from this folder.

**Chrome, Edge, Brave**

1. Download the zip from the Whiteboard page (it offers it when the extension is
   missing), or copy this folder, and unzip it somewhere it can stay.
2. Go to `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the folder.

To update it, replace the folder's contents and click the reload icon on the
extension's card.

**Firefox**

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and choose the downloaded zip, or `manifest.json`
   in this folder.

Firefox removes temporary add-ons when it restarts, so this has to be repeated each
time.

## Use

1. Open <https://ethanphillips.dev/whiteboard/>.
2. Enter your school's Blackboard address and click **Connect**.
3. Click **Allow access** on the page the extension opens.
4. Sign in to Blackboard in the tab that opens. It closes itself when you're done.

If a file won't download, the error names the server Blackboard keeps it on. Click the
extension's icon, press **Allow access** again, and retry.

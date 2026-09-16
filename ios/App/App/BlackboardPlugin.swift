import Capacitor
import Foundation
import UIKit

/// The page's way to Blackboard inside the app. It answers the messages
/// `extension/background.js` answers, with the same replies, so `src/browser/bridge.js`
/// only has to pick which of the two to ask.
///
/// Replies cross as a JSON string rather than as a Capacitor object: Blackboard's
/// JSON is full of nulls and nesting, and a string arrives exactly as it was sent.
@objc(BlackboardPlugin)
public class BlackboardPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BlackboardPlugin"
    public let jsName = "Blackboard"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ask", returnType: CAPPluginReturnPromise),
    ]

    private let blackboard = Blackboard.shared
    private var login: LoginViewController?

    @objc func ask(_ call: CAPPluginCall) {
        Task {
            let reply = await handle(call)
            call.resolve(["reply": Blackboard.json(reply)])
        }
    }

    private func handle(_ call: CAPPluginCall) async -> Blackboard.Reply {
        // The app's own bundled page, and nothing else that might end up in the web
        // view — the same check as PAGES in the extension, for the same reason.
        let allowed = await MainActor.run { () -> Bool in
            guard let page = self.bridge?.webView?.url, let local = self.bridge?.config.localURL else { return false }
            return page.scheme == local.scheme && page.host == local.host
        }
        guard allowed else {
            return ["error": "refused", "message": "This page is not allowed to read Blackboard."]
        }

        let path = call.getString("path") ?? ""
        switch call.getString("type") {
        case "ping":
            let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
            return ["ok": true, "version": version ?? "0"]
        case "status":
            let status = await blackboard.status()
            if status["state"] as? String == "signed-in" { await closeLogin() }
            return status
        case "connect":
            return await blackboard.connect(call.getString("host") ?? "")
        case "signin":
            return await openLogin()
        case "get":
            return await blackboard.apiGet(path)
        case "file":
            return await blackboard.fileGet(path)
        case "range":
            return await blackboard.rangeReply(path, start: call.getInt("start") ?? 0, end: call.getInt("end"))
        case "stream":
            // A video's id, so the stream handler can find its path without the path
            // ever being written into the page's markup.
            guard let id = call.getString("id"), !id.isEmpty else { return ["error": "refused"] }
            await StreamHandler.shared.register(id: id, path: path, type: call.getString("mime") ?? "")
            return ["ok": true]
        case "host":
            return ["host": blackboard.host.map { $0 as Any } ?? NSNull()]
        case "disconnect":
            await closeLogin()
            return await blackboard.disconnect()
        case let other:
            return ["error": "unknown", "message": "No such request: \(other ?? "nothing")"]
        }
    }

    // Blackboard's front door, not a login URL: every institution sends it on to its
    // own identity provider, and a URL built here would be right at only some of them.
    @MainActor private func openLogin() async -> Blackboard.Reply {
        guard let origin = blackboard.host, let url = URL(string: origin + "/") else {
            return ["error": "not-connected"]
        }
        if login?.presentingViewController != nil { return ["ok": true] }
        let controller = LoginViewController(url: url)
        login = controller
        bridge?.viewController?.present(UINavigationController(rootViewController: controller), animated: true)
        return ["ok": true]
    }

    // Closed from here, when status first sees a user — the page's own polling is
    // what notices the sign-in, as it is with the extension's tab.
    @MainActor private func closeLogin() async {
        guard let controller = login else { return }
        login = nil
        controller.navigationController?.dismiss(animated: true)
    }
}

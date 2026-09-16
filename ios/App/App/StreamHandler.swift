import Foundation
import WebKit

/// Lecture recordings, in the app. On the web a service worker answers the <video>
/// element's range requests; a web view served from `capacitor://` has no service
/// workers, so this scheme handler does that job, and asks Blackboard directly
/// rather than going back through the page.
///
/// The page registers each video's id with its path (the plugin's `stream`), and the
/// element asks for `whiteboard-stream://video/<id>`. The path stays out of the URL
/// for the reason it does on the web: the address of a video is not something to
/// write into the DOM.
@MainActor
final class StreamHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "whiteboard-stream"
    static let shared = StreamHandler()

    private struct Source {
        let path: String
        let type: String
        var total: Int?
    }

    private var sources: [String: Source] = [:]
    // Tasks WebKit still wants answers for. Calling a task after WebKit stopped it
    // raises an Objective-C exception, so every answer checks it is still here.
    private var running: [ObjectIdentifier: Task<Void, Never>] = [:]

    func register(id: String, path: String, type: String) {
        if sources[id] == nil { sources[id] = Source(path: path, type: type, total: nil) }
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask)
        running[key] = Task { [weak self] in
            await self?.answer(urlSchemeTask)
            self?.running[key] = nil
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        running.removeValue(forKey: ObjectIdentifier(urlSchemeTask))?.cancel()
    }

    private func answer(_ task: WKURLSchemeTask) async {
        guard let url = task.request.url else { return fail(task, "No address.") }
        let id = url.lastPathComponent

        // The page registers the id and sets the element's src in the same breath,
        // and the two cross the bridge separately; the element can win that race.
        var source = sources[id]
        for _ in 0..<50 where source == nil {
            try? await Task.sleep(nanoseconds: 100_000_000)
            if Task.isCancelled { return }
            source = sources[id]
        }
        guard let found = source else { return fail(task, "That video is no longer open.") }

        let (first, last) = Self.parseRange(task.request.value(forHTTPHeaderField: "Range"))
        let result = await Blackboard.shared.range(found.path, start: first, end: last)
        guard running[ObjectIdentifier(task)] != nil, !Task.isCancelled else { return }

        switch result {
        case .failure(let failure):
            let message = failure.reply["message"] as? String ?? failure.reply["error"] as? String ?? "failed"
            fail(task, message)
        case .success(let slice):
            // What the server said the first time is kept: a later chunk that omits
            // the total must not make a seekable video stop being so.
            if let total = slice.total { sources[id]?.total = total }
            let total = slice.total ?? sources[id]?.total
            let generic: Set<String> = ["", "application/octet-stream", "binary/octet-stream"]
            let served = slice.type.split(separator: ";").first.map(String.init) ?? ""
            let type = generic.contains(served) ? (found.type.isEmpty ? served : found.type) : served
            let end = slice.start + slice.data.count - 1
            let headers = [
                "Content-Type": type.isEmpty ? "application/octet-stream" : type,
                "Content-Length": String(slice.data.count),
                "Content-Range": "bytes \(slice.start)-\(end)/\(total.map(String.init) ?? "*")",
                "Accept-Ranges": "bytes",
                "Cache-Control": "no-store",
            ]
            let response = HTTPURLResponse(url: url, statusCode: 206, httpVersion: "HTTP/1.1",
                                           headerFields: headers)!
            task.didReceive(response)
            task.didReceive(slice.data)
            task.didFinish()
        }
    }

    /// 502 with the reason as its body, as the service worker does, so the element
    /// shows its own error and the reason reaches the console.
    private func fail(_ task: WKURLSchemeTask, _ message: String) {
        guard running[ObjectIdentifier(task)] != nil, let url = task.request.url else { return }
        print("[whiteboard] video stream failed: \(message)")
        let body = Data("Whiteboard could not read that range: \(message)".utf8)
        let response = HTTPURLResponse(url: url, statusCode: 502, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "text/plain"])!
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }

    /// `bytes=1048576-` → (1048576, nil).
    nonisolated static func parseRange(_ header: String?) -> (Int, Int?) {
        let value = (header ?? "").trimmingCharacters(in: .whitespaces)
        guard value.hasPrefix("bytes=") else { return (0, nil) }
        let parts = value.dropFirst("bytes=".count).split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return (0, nil) }
        return (Int(parts[0]) ?? 0, Int(parts[1]))
    }
}

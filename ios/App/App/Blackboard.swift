import Foundation
import WebKit

/// The only code in the app that talks to Blackboard: the counterpart of
/// `extension/background.js`, and held to the same rule. GET, under the public REST
/// API (plus `/bbcswebdav/` for files), on the one host the person connected. The
/// page can ask for anything; this decides. Its replies are the extension's, shape
/// for shape, so nothing above `src/browser/bridge.js` knows which one answered.
///
/// Two of the extension's workarounds have no counterpart here, because the reasons
/// for them are browser rules a native request is not subject to: there is no
/// `Origin` header to strip, and no host permission to ask for before a file
/// redirects to storage somewhere else.
final class Blackboard {
    static let shared = Blackboard()

    typealias Reply = [String: Any]

    static let apiPrefix = "/learn/api/public/"
    static let filePrefixes = [apiPrefix, "/bbcswebdav/"]
    // Kept at the extension's figures. A file still crosses to the page as base64
    // in one message, and the bridge has limits of its own that nobody has measured.
    static let maxFile = 32 * 1024 * 1024
    static let maxChunk = 8 * 1024 * 1024

    private static let hostKey = "whiteboard.host"

    var host: String? {
        get { UserDefaults.standard.string(forKey: Self.hostKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.hostKey) }
    }

    // Nothing cached: a response belongs to one session, and a stale gradebook
    // served from a URL cache would be wrong in a way nobody could see.
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 60
        return URLSession(configuration: config)
    }()

    // MARK: - Hosts and paths

    /// `blackboard.university.edu` → `https://blackboard.university.edu`, as
    /// `blackboardOrigin` in `extension/origin.js` does it.
    static func origin(from raw: String) throws -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { throw Refusal("Enter your Blackboard address.") }
        if s.range(of: "^[a-z]+://", options: [.regularExpression, .caseInsensitive]) == nil {
            s = "https://" + s
        }
        guard let url = URL(string: s), let host = url.host, !host.isEmpty else {
            throw Refusal("That isn't a web address.")
        }
        // A session cookie sent in the clear is one anybody on the network can reuse.
        guard url.scheme?.lowercased() == "https" else {
            throw Refusal("Blackboard has to be an https:// address.")
        }
        return originOf(url)!
    }

    static func originOf(_ url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return nil }
        return url.port.map { "\(scheme)://\(host):\($0)" } ?? "\(scheme)://\(host)"
    }

    /// The path resolved against the connected host, or nil if it lands anywhere
    /// but under one of `prefixes` there. Resolved first and checked after, so a
    /// full URL to another host comes out with a different origin.
    private func resolve(_ path: String, prefixes: [String]) -> URL? {
        guard let origin = host, let base = URL(string: origin),
              let url = URL(string: path, relativeTo: base)?.absoluteURL.standardized,
              Self.originOf(url) == origin else { return nil }
        // Checked decoded as well: `%2e%2e` is `..` to a server that decodes before
        // it routes, and standardizing does not see it.
        let decoded = url.path
        if decoded.split(separator: "/").contains("..") { return nil }
        return prefixes.contains(where: { url.path.hasPrefix($0) }) ? url : nil
    }

    // MARK: - Cookies

    // The sign-in sheet is a web view, so the session lands in WebKit's cookie store;
    // URLSession has a jar of its own. Copied in before each request and back after
    // it, so a cookie Blackboard rotates mid-session is not lost to the web view.
    @MainActor private func webCookies() async -> [HTTPCookie] {
        await withCheckedContinuation { done in
            WKWebsiteDataStore.default().httpCookieStore.getAllCookies { done.resume(returning: $0) }
        }
    }

    private func loadCookies() async {
        for cookie in await webCookies() { HTTPCookieStorage.shared.setCookie(cookie) }
    }

    private func saveCookies(for url: URL) async {
        let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
        await MainActor.run {
            let store = WKWebsiteDataStore.default().httpCookieStore
            for cookie in cookies { store.setCookie(cookie) }
        }
    }

    private func forgetCookies(for origin: String) async {
        guard let host = URL(string: origin)?.host else { return }
        let mine = { (cookie: HTTPCookie) -> Bool in
            let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
            return host == domain || host.hasSuffix("." + domain)
        }
        for cookie in HTTPCookieStorage.shared.cookies ?? [] where mine(cookie) {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
        let cookies = await webCookies()
        await MainActor.run {
            let store = WKWebsiteDataStore.default().httpCookieStore
            for cookie in cookies where mine(cookie) { store.delete(cookie) }
        }
    }

    // MARK: - Requests

    func apiGet(_ path: String) async -> Reply {
        guard let origin = host else { return ["error": "not-connected"] }
        guard let url = resolve(path, prefixes: [Self.apiPrefix]) else {
            return ["error": "refused", "message": "Only \(Self.apiPrefix)… on \(origin) can be read."]
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        await loadCookies()
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request, delegate: Redirects.refused)
        } catch {
            return network(error)
        }
        await saveCookies(for: url)
        guard let http = response as? HTTPURLResponse else { return network(nil) }

        // An expired session redirects to the login page rather than answering 401…
        if (300..<400).contains(http.statusCode) || http.statusCode == 401 {
            return ["error": "signed-out", "status": http.statusCode]
        }
        // …but 403 is a live session looking at something closed to students.
        if http.statusCode == 403 { return ["error": "forbidden", "status": 403] }
        // …and some configurations answer 200 with the login page's HTML instead.
        let type = http.value(forHTTPHeaderField: "Content-Type") ?? ""
        if !type.contains("json") { return ["error": "signed-out", "status": http.statusCode] }

        let json = (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) ?? NSNull()
        if !(200..<300).contains(http.statusCode) {
            return ["error": "http", "status": http.statusCode, "data": json]
        }
        return ["ok": true, "status": http.statusCode, "data": json]
    }

    func fileGet(_ path: String) async -> Reply {
        guard let url = resolve(path, prefixes: Self.filePrefixes) else { return refusedFile() }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 180

        await loadCookies()
        let saved: URL
        let response: URLResponse
        do {
            // Followed, unlike apiGet: the download endpoint answers with a redirect
            // to where the file is stored, and following it is the only way there.
            (saved, response) = try await session.download(for: request, delegate: Redirects.https)
        } catch {
            return network(error)
        }
        defer { try? FileManager.default.removeItem(at: saved) }
        await saveCookies(for: url)
        guard let http = response as? HTTPURLResponse else { return network(nil) }
        if let failed = fileFailure(http) { return failed }

        let size = (try? FileManager.default.attributesOfItem(atPath: saved.path)[.size] as? Int) ?? 0
        if size > Self.maxFile {
            return ["error": "too-large", "message": "That file is too large to fetch here."]
        }
        guard let data = try? Data(contentsOf: saved) else { return network(nil) }
        var reply: Reply = [
            "ok": true,
            "status": http.statusCode,
            "type": http.value(forHTTPHeaderField: "Content-Type") ?? "",
            "bytes": data.count,
            "base64": data.base64EncodedString(),
        ]
        reply["disposition"] = http.value(forHTTPHeaderField: "Content-Disposition").map { $0 as Any } ?? NSNull()
        return reply
    }

    struct Slice {
        let data: Data
        let type: String
        let start: Int
        let total: Int?
    }

    /// One slice of a file, for the video player. Refused, as in the extension, when
    /// the server ignores Range: a 200 is the whole lecture, and it is dropped unread.
    func range(_ path: String, start: Int, end: Int?) async -> Result<Slice, Failure> {
        guard let url = resolve(path, prefixes: Self.filePrefixes) else {
            return .failure(Failure(refusedFile()))
        }
        let first = max(0, start)
        let wanted = end.flatMap { $0 >= first ? min($0, first + Self.maxChunk - 1) : nil }
            ?? first + Self.maxChunk - 1
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 120
        request.setValue("bytes=\(first)-\(wanted)", forHTTPHeaderField: "Range")

        await loadCookies()
        do {
            let (bytes, response) = try await session.bytes(for: request, delegate: Redirects.https)
            guard let http = response as? HTTPURLResponse else { return .failure(Failure(network(nil))) }
            if http.statusCode == 200 {
                bytes.task.cancel()
                return .failure(Failure(["error": "no-range",
                    "message": "That server sends whole files only, so the video can't be streamed here."]))
            }
            if let failed = fileFailure(http) {
                bytes.task.cancel()
                return .failure(Failure(failed))
            }
            if http.statusCode != 206 {
                bytes.task.cancel()
                return .failure(Failure(["error": "http", "status": http.statusCode]))
            }
            var data = Data()
            data.reserveCapacity(wanted - first + 1)
            for try await byte in bytes {
                data.append(byte)
                if data.count > Self.maxChunk {
                    bytes.task.cancel()
                    return .failure(Failure(["error": "no-range",
                        "message": "That server returned more than was asked for."]))
                }
            }
            await saveCookies(for: url)
            let total = Self.total(fromContentRange: http.value(forHTTPHeaderField: "Content-Range"))
            return .success(Slice(data: data, type: http.value(forHTTPHeaderField: "Content-Type") ?? "",
                                  start: first, total: total))
        } catch {
            return .failure(Failure(network(error)))
        }
    }

    /// `bytes 0-1048575/419430400` → its total. Nil when the header is missing or says
    /// `*`, which is a server that will not tell us how long the file is.
    static func total(fromContentRange header: String?) -> Int? {
        guard let header = header, let slash = header.lastIndex(of: "/") else { return nil }
        return Int(header[header.index(after: slash)...].trimmingCharacters(in: .whitespaces))
    }

    func rangeReply(_ path: String, start: Int, end: Int?) async -> Reply {
        switch await range(path, start: start, end: end) {
        case .failure(let failure):
            return failure.reply
        case .success(let slice):
            return [
                "ok": true,
                "status": 206,
                "type": slice.type,
                "total": slice.total.map { $0 as Any } ?? NSNull(),
                "start": slice.start,
                "end": slice.start + slice.data.count - 1,
                "bytes": slice.data.count,
                "base64": slice.data.base64EncodedString(),
            ]
        }
    }

    // MARK: - Session

    func status() async -> Reply {
        guard let origin = host else { return ["state": "not-connected"] }
        // A BbRouter cookie proves nothing on its own — Blackboard hands one to
        // anonymous visitors — so "signed in" means users/me answered with a user.
        let me = await apiGet("/learn/api/public/v1/users/me")
        if me["ok"] as? Bool == true, let user = me["data"] as? [String: Any], user["id"] != nil {
            return ["state": "signed-in", "host": origin, "user": user]
        }
        if me["error"] as? String == "signed-out" { return ["state": "signed-out", "host": origin] }
        return ["state": "error", "host": origin, "detail": me]
    }

    func connect(_ raw: String) async -> Reply {
        do {
            host = try Self.origin(from: raw)
        } catch {
            return ["error": "refused", "message": (error as? Refusal)?.message ?? "\(error)"]
        }
        // Nothing to grant: the app is the browser, so connecting is only choosing.
        return await status()
    }

    /// Unlike the extension, this does end the session. There the cookies belong to
    /// a browser the person also uses for Blackboard itself; here they belong to
    /// this app alone, and leaving them would make "Use a different Blackboard" —
    /// or a different account — impossible.
    func disconnect() async -> Reply {
        if let origin = host { await forgetCookies(for: origin) }
        host = nil
        return ["ok": true]
    }

    // MARK: - Failures

    struct Refusal: Error {
        let message: String
        init(_ message: String) { self.message = message }
    }

    struct Failure: Error {
        let reply: Reply
        init(_ reply: Reply) { self.reply = reply }
    }

    private func refusedFile() -> Reply {
        ["error": "refused", "message": "Only files on \(host ?? "your Blackboard") can be fetched."]
    }

    /// The failures a file and a slice share, or nil if the response is usable.
    private func fileFailure(_ http: HTTPURLResponse) -> Reply? {
        // The one redirect that means something else: back to the login page.
        if http.statusCode == 401 || http.url?.path.contains("/webapps/login") == true {
            return ["error": "signed-out", "status": http.statusCode]
        }
        if (300..<400).contains(http.statusCode) {
            // Only a redirect Redirects.https refused lands here.
            return ["error": "network", "message": "Blackboard sent that file somewhere that isn't https."]
        }
        if http.statusCode == 403 { return ["error": "forbidden", "status": 403] }
        if !(200..<300).contains(http.statusCode) { return ["error": "http", "status": http.statusCode] }
        return nil
    }

    private func network(_ error: Error?) -> Reply {
        ["error": "network", "message": error.map { $0.localizedDescription } ?? "No response."]
    }

    static func json(_ reply: Reply) -> String {
        guard JSONSerialization.isValidJSONObject(reply),
              let data = try? JSONSerialization.data(withJSONObject: reply),
              let text = String(data: data, encoding: .utf8) else {
            return #"{"error":"exception","message":"The reply could not be encoded."}"#
        }
        return text
    }
}

/// What a request does when it is redirected.
final class Redirects: NSObject, URLSessionTaskDelegate {
    /// For the API, where a redirect only ever means the login page.
    static let refused = Redirects(follow: false)
    /// For files, which redirect to storage — but never down to plain http.
    static let https = Redirects(follow: true)

    private let follow: Bool
    private init(follow: Bool) { self.follow = follow }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        let secure = request.url?.scheme?.lowercased() == "https"
        guard follow, secure else { return completionHandler(nil) }
        // Only ever a GET, whatever a 303 might otherwise suggest.
        var next = request
        next.httpMethod = "GET"
        next.httpBody = nil
        completionHandler(next)
    }
}

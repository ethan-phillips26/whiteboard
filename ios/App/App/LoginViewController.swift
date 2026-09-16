import UIKit
import WebKit

/// Blackboard's own sign-in, in a sheet over the app: the counterpart of the tab the
/// extension opens. It uses the default website data store, which is where
/// `Blackboard` reads the session from once the university has set it.
///
/// Nothing in here is trusted or inspected. It is a browser pointed at Blackboard's
/// front door; whether it worked is decided by `users/me`, not by what this shows.
final class LoginViewController: UIViewController, WKUIDelegate {
    private let url: URL
    private var webView: WKWebView!

    init(url: URL) {
        self.url = url
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not used from a storyboard") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Blackboard sign-in"
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.uiDelegate = self
        view.addSubview(webView)
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .close, target: self, action: #selector(close))
        webView.load(URLRequest(url: url))
    }

    @objc private func close() {
        navigationController?.dismiss(animated: true)
    }

    // Identity providers open popups for things like "sign in with another
    // account". A sheet has nowhere to put a second window, so the popup's page
    // replaces this one.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
        return nil
    }
}

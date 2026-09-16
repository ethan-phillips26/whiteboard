import Capacitor
import WebKit

/// Capacitor's web view, with the two things this app adds to it: the Blackboard
/// plugin, which lives in the app target rather than in a package of its own, and
/// the scheme lecture recordings stream over.
class WhiteboardViewController: CAPBridgeViewController {
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        config.setURLSchemeHandler(StreamHandler.shared, forURLScheme: StreamHandler.scheme)
        return config
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(BlackboardPlugin())
    }
}

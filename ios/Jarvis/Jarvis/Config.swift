import Foundation

enum Config {
    #if DEBUG
    static let baseURL = URL(string: "http://localhost:3000")!
    #else
    static let baseURL = URL(string: "https://v2-jarvis-audio-production.up.railway.app")!
    #endif
}

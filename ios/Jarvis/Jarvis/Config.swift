import Foundation

enum Config {
    #if DEBUG
    static let baseURL = URL(string: "https://trustworthy-solace-production-639b.up.railway.app")!
    #else
    static let baseURL = URL(string: "https://trustworthy-solace-production-639b.up.railway.app")!
    #endif
}

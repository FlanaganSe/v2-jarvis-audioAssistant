import SwiftUI

@main
struct JarvisApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .onAppear {
                    Task {
                        do {
                            let session = try await APIClient.createSession()
                            print("[M1 verify] ephemeralKey: \(session.ephemeralKey.prefix(20))...")
                        } catch {
                            print("[M1 verify] createSession failed: \(error)")
                        }

                        do {
                            let sessions = try await APIClient.listSessions()
                            print("[M1 verify] listSessions returned \(sessions.count) sessions")
                            for s in sessions.prefix(3) {
                                print("  - \(s.id) started \(s.startedAt)")
                            }
                        } catch {
                            print("[M1 verify] listSessions failed: \(error)")
                        }
                    }
                }
        }
    }
}

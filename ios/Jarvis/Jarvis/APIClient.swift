import Foundation

enum APIClient {

    // MARK: - POST /api/session → { ephemeralKey }

    struct SessionResponse: Decodable {
        let ephemeralKey: String
    }

    static func createSession() async throws -> SessionResponse {
        var request = URLRequest(url: Config.baseURL.appendingPathComponent("api/session"))
        request.httpMethod = "POST"
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.sessionCreationFailed
        }
        return try JSONDecoder().decode(SessionResponse.self, from: data)
    }

    // MARK: - POST /api/session/sideband

    struct SidebandBody: Encodable {
        let callId: String
        let ephemeralKey: String
    }

    static func connectSideband(callId: String, ephemeralKey: String) async throws {
        var request = URLRequest(url: Config.baseURL.appendingPathComponent("api/session/sideband"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(SidebandBody(callId: callId, ephemeralKey: ephemeralKey))
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            print("[API] Sideband connection failed — tools will not work")
            return
        }
    }

    // MARK: - GET /api/sessions

    static func listSessions() async throws -> [SessionSummary] {
        let url = Config.baseURL.appendingPathComponent("api/sessions")
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            return []
        }
        return try JSONDecoder().decode([SessionSummary].self, from: data)
    }

    // MARK: - GET /api/sessions/:id/turns

    static func getSessionTurns(id: String) async throws -> SessionDetail? {
        let url = Config.baseURL
            .appendingPathComponent("api/sessions")
            .appendingPathComponent(id)
            .appendingPathComponent("turns")
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            return nil
        }
        return try JSONDecoder().decode(SessionDetail.self, from: data)
    }

    // MARK: - Errors

    enum APIError: LocalizedError {
        case sessionCreationFailed

        var errorDescription: String? {
            switch self {
            case .sessionCreationFailed:
                return "Failed to create session"
            }
        }
    }
}

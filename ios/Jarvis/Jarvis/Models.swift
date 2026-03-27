import Foundation

// MARK: - Voice State

enum VoiceState: String {
    case disconnected
    case connecting
    case ready
    case listening
    case processing
    case working
    case speaking
    case error
}

// MARK: - Transcript

struct TranscriptEntry: Identifiable {
    let id = UUID()
    let role: TranscriptRole
    var text: String
    var isFinal: Bool
    var toolName: String?

    enum TranscriptRole: String {
        case user
        case assistant
        case tool
    }
}

// MARK: - Session History

struct SessionSummary: Codable, Identifiable {
    let id: String
    let startedAt: String
    let endedAt: String?
    let topics: [String]?
}

struct SessionSummaryData: Codable {
    let topics: [String]?
    let keyFacts: [String]?
    let unresolved: [String]?
}

struct Turn: Codable, Identifiable {
    let id: String
    let role: String
    let content: String
    let createdAt: String
}

struct SessionDetail: Codable {
    let id: String
    let startedAt: String
    let endedAt: String?
    let turns: [Turn]
    let summary: SessionSummaryData?
}

// MARK: - GitHub Digest

enum GitHubDigest {
    case repo(data: RepoDigest, sourceUrl: String?)
    case issue(data: IssueDigest, sourceUrl: String?)
    case pull(data: PullDigest, sourceUrl: String?)
    case file(data: FileDigest, sourceUrl: String?)
}

struct RepoDigest: Codable {
    let name: String
    let description: String?
    let language: String?
    let stars: Int
    let forks: Int
    let openIssues: Int
    let topics: [String]
}

struct IssueDigest: Codable {
    let title: String
    let state: String
    let author: String?
    let commentCount: Int
    let labels: [String]
}

struct PullDigest: Codable {
    let title: String
    let state: String
    let merged: Bool
    let author: String?
    let additions: Int
    let deletions: Int
    let changedFiles: Int
    let reviewCommentCount: Int
}

struct FileDigest: Codable {
    let path: String
    let size: Int
}

// MARK: - OpenAI Realtime Events

struct RealtimeEvent: Decodable {
    let type: String
    let delta: String?
    let transcript: String?
    let name: String?
    let session: RealtimeSession?
    let item: RealtimeItem?
    let error: RealtimeError?

    enum CodingKeys: String, CodingKey {
        case type, delta, transcript, name, session, item, error
    }
}

struct RealtimeError: Decodable {
    let message: String?
    let code: String?
}

struct RealtimeSession: Decodable {
    let turnDetection: AnyCodable?

    enum CodingKeys: String, CodingKey {
        case turnDetection = "turn_detection"
    }
}

struct RealtimeItem: Decodable {
    let type: String?
    let output: String?
}

// Lightweight wrapper for arbitrary JSON values in Decodable contexts
struct AnyCodable: Decodable {
    let value: Any

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let s = try? container.decode(String.self) {
            value = s
        } else if let b = try? container.decode(Bool.self) {
            value = b
        } else if let i = try? container.decode(Int.self) {
            value = i
        } else if let d = try? container.decode(Double.self) {
            value = d
        } else {
            value = NSNull()
        }
    }
}

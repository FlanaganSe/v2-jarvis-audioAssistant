import SwiftUI

struct SessionHistoryView: View {
    @State private var sessions: [SessionSummary] = []
    @State private var isLoading = true

    var body: some View {
        List {
            if isLoading {
                ProgressView("Loading sessions...")
                    .frame(maxWidth: .infinity, alignment: .center)
                    .listRowBackground(Color.clear)
            } else if sessions.isEmpty {
                Text("No sessions yet")
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .listRowBackground(Color.clear)
            } else {
                ForEach(sessions) { session in
                    NavigationLink(destination: SessionDetailView(sessionId: session.id)) {
                        SessionRow(session: session)
                    }
                }
            }
        }
        .navigationTitle("History")
        .task {
            sessions = (try? await APIClient.listSessions()) ?? []
            isLoading = false
        }
    }
}

private struct SessionRow: View {
    let session: SessionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(formatDate(session.startedAt))
                .font(.subheadline)
                .fontWeight(.medium)
            if let topics = session.topics, !topics.isEmpty {
                Text(topics.joined(separator: ", "))
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }
}

private struct SessionDetailView: View {
    let sessionId: String
    @State private var detail: SessionDetail?
    @State private var isLoading = true

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading...")
            } else if let detail {
                List {
                    if let summary = detail.summary {
                        Section("Summary") {
                            if let topics = summary.topics, !topics.isEmpty {
                                LabeledContent("Topics", value: topics.joined(separator: ", "))
                            }
                            if let facts = summary.keyFacts {
                                ForEach(facts, id: \.self) { fact in
                                    Text(fact).font(.caption)
                                }
                            }
                        }
                    }
                    Section("Turns (\(detail.turns.count))") {
                        ForEach(detail.turns) { turn in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(turn.role.capitalized)
                                    .font(.caption2)
                                    .foregroundColor(turn.role == "assistant" ? .cyan : .secondary)
                                Text(turn.content)
                                    .font(.callout)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            } else {
                Text("Session not found")
                    .foregroundColor(.secondary)
            }
        }
        .navigationTitle("Session")
        .task {
            detail = try? await APIClient.getSessionTurns(id: sessionId)
            isLoading = false
        }
    }
}

private func formatDate(_ iso: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: iso) else { return iso }
    let display = DateFormatter()
    display.dateStyle = .medium
    display.timeStyle = .short
    return display.string(from: date)
}

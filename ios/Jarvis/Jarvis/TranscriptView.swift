import SwiftUI

struct TranscriptView: View {
    let entries: [TranscriptEntry]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(entries) { entry in
                        TranscriptRow(entry: entry)
                            .id(entry.id)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
            }
            .onChange(of: entries.count) {
                if let last = entries.last {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
    }
}

private struct TranscriptRow: View {
    let entry: TranscriptEntry

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(roleLabel)
                .font(.caption2)
                .fontWeight(.medium)
                .foregroundColor(roleColor)
                .frame(width: 50, alignment: .trailing)

            Text(entry.text)
                .font(.callout)
                .foregroundColor(entry.role == .tool ? .secondary : .primary)
        }
    }

    private var roleLabel: String {
        switch entry.role {
        case .user: "You"
        case .assistant: "Jarvis"
        case .tool: "Tool"
        }
    }

    private var roleColor: Color {
        switch entry.role {
        case .user: .cyan
        case .assistant: .white
        case .tool: .purple
        }
    }
}

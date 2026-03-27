import SwiftUI

struct GitHubDigestCard: View {
    let digest: GitHubDigest

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("GitHub \(typeLabel)")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                if let url = sourceUrl {
                    Link("View on GitHub", destination: url)
                        .font(.caption)
                        .foregroundColor(.cyan)
                }
            }

            switch digest {
            case .repo(let data, _): RepoCardView(data: data)
            case .issue(let data, _): IssueCardView(data: data)
            case .pull(let data, _): PullCardView(data: data)
            case .file(let data, _): FileCardView(data: data)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }

    private var typeLabel: String {
        switch digest {
        case .repo: "Repository"
        case .issue: "Issue"
        case .pull: "Pull Request"
        case .file: "File"
        }
    }

    private var sourceUrl: URL? {
        let urlString: String?
        switch digest {
        case .repo(_, let s): urlString = s
        case .issue(_, let s): urlString = s
        case .pull(_, let s): urlString = s
        case .file(_, let s): urlString = s
        }
        return urlString.flatMap { URL(string: $0) }
    }
}

// MARK: - Card Variants

private struct RepoCardView: View {
    let data: RepoDigest

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(data.name).font(.subheadline).fontWeight(.semibold)
            if let desc = data.description {
                Text(desc).font(.caption).foregroundColor(.secondary)
            }
            HStack(spacing: 12) {
                if let lang = data.language { Label(lang, systemImage: "circle.fill").font(.caption2) }
                Label("\(data.stars)", systemImage: "star").font(.caption2)
                Label("\(data.forks)", systemImage: "tuningfork").font(.caption2)
            }
            .foregroundColor(.secondary)
            if !data.topics.isEmpty {
                FlowTags(items: Array(data.topics.prefix(6)))
            }
        }
    }
}

private struct IssueCardView: View {
    let data: IssueDigest

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                StateBadge(state: data.state)
                Text(data.title).font(.subheadline).fontWeight(.semibold)
            }
            HStack(spacing: 12) {
                if let author = data.author { Text("by \(author)").font(.caption2) }
                Text("\(data.commentCount) comments").font(.caption2)
            }
            .foregroundColor(.secondary)
            if !data.labels.isEmpty {
                FlowTags(items: data.labels)
            }
        }
    }
}

private struct PullCardView: View {
    let data: PullDigest

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                StateBadge(state: data.merged ? "merged" : data.state)
                Text(data.title).font(.subheadline).fontWeight(.semibold)
            }
            HStack(spacing: 12) {
                if let author = data.author { Text("by \(author)").font(.caption2) }
                Text("+\(data.additions)").font(.caption2).foregroundColor(.green)
                Text("-\(data.deletions)").font(.caption2).foregroundColor(.red)
                Text("\(data.changedFiles) files").font(.caption2)
            }
            .foregroundColor(.secondary)
        }
    }
}

private struct FileCardView: View {
    let data: FileDigest

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(data.path).font(.subheadline).fontWeight(.semibold)
            Text(String(format: "%.1f KB", Double(data.size) / 1024.0))
                .font(.caption).foregroundColor(.secondary)
        }
    }
}

// MARK: - Helpers

private struct StateBadge: View {
    let state: String

    var body: some View {
        Text(state)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(badgeColor.opacity(0.3))
            .foregroundColor(badgeColor)
            .cornerRadius(4)
    }

    private var badgeColor: Color {
        switch state {
        case "open": .green
        case "merged": .purple
        case "closed": .red
        default: .gray
        }
    }
}

private struct FlowTags: View {
    let items: [String]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(items, id: \.self) { item in
                Text(item)
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color(.systemGray5))
                    .cornerRadius(8)
            }
        }
    }
}

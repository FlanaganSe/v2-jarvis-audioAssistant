import SwiftUI

struct StatusIndicator: View {
    let state: VoiceState

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(color)
                .frame(width: 10, height: 10)
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
    }

    private var label: String {
        switch state {
        case .disconnected: "Disconnected"
        case .connecting: "Connecting..."
        case .ready: "Ready"
        case .listening: "Listening..."
        case .processing: "Processing..."
        case .working: "Using tools..."
        case .speaking: "Speaking..."
        case .error: "Error"
        }
    }

    private var color: Color {
        switch state {
        case .disconnected: .gray
        case .connecting: .orange
        case .ready: .green
        case .listening: .red
        case .processing: .yellow
        case .working: .purple
        case .speaking: .cyan
        case .error: .red
        }
    }
}

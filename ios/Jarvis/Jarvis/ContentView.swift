import SwiftUI

struct ContentView: View {
    @StateObject private var manager = WebRTCManager()

    var body: some View {
        VStack(spacing: 20) {
            Text("Jarvis")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text(manager.state.rawValue)
                .font(.headline)
                .foregroundColor(stateColor)

            if manager.state == .disconnected || manager.state == .error {
                Button("Connect") {
                    Task { await manager.connect() }
                }
                .buttonStyle(.borderedProminent)
            } else if manager.state == .connecting {
                ProgressView("Connecting...")
            } else {
                Button("Disconnect") {
                    manager.disconnect()
                }
                .buttonStyle(.bordered)
                .tint(.red)
            }

            if manager.state != .disconnected && manager.state != .connecting
                && manager.state != .error
            {
                Text("Hold to Talk")
                    .font(.headline)
                    .padding(.horizontal, 32)
                    .padding(.vertical, 16)
                    .background(manager.state == .listening ? Color.red : Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { _ in
                                if manager.state != .listening {
                                    manager.startTalking()
                                }
                            }
                            .onEnded { _ in
                                manager.stopTalking()
                            }
                    )
            }

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(manager.transcript) { entry in
                        HStack(alignment: .top, spacing: 8) {
                            Text(entry.role.rawValue)
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .frame(width: 55, alignment: .trailing)
                            Text(entry.text)
                                .font(.body)
                        }
                    }
                }
                .padding(.horizontal)
            }
        }
        .padding()
    }

    private var stateColor: Color {
        switch manager.state {
        case .disconnected: .gray
        case .connecting: .orange
        case .ready: .green
        case .listening: .red
        case .processing: .yellow
        case .working: .purple
        case .speaking: .blue
        case .error: .red
        }
    }
}

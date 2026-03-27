import SwiftUI

struct ContentView: View {
    @StateObject private var manager = WebRTCManager()
    @State private var showHistory = false

    private var isConnected: Bool {
        manager.state != .disconnected && manager.state != .error && manager.state != .connecting
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Status
                    StatusIndicator(state: manager.state)
                        .padding(.top, 8)

                    // Connect / Disconnect
                    if manager.state == .disconnected || manager.state == .error {
                        Button {
                            Task { await manager.connect() }
                        } label: {
                            Text("Connect")
                                .font(.headline)
                                .frame(width: 140, height: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.cyan)
                    } else if manager.state == .connecting {
                        ProgressView()
                    } else {
                        Button {
                            manager.disconnect()
                        } label: {
                            Text("Disconnect")
                                .font(.subheadline)
                                .frame(width: 120, height: 36)
                        }
                        .buttonStyle(.bordered)
                        .tint(.gray)
                    }

                    // PTT button (only in PTT mode, when connected)
                    if isConnected && manager.vadMode == .ptt {
                        PttButton(
                            disabled: !isConnected,
                            isListening: manager.state == .listening,
                            onStart: { manager.startTalking() },
                            onStop: { manager.stopTalking() }
                        )
                    }

                    // VAD toggle
                    if isConnected {
                        Picker("Input Mode", selection: Binding(
                            get: { manager.vadMode },
                            set: { manager.setVadMode($0) }
                        )) {
                            Text("Push to Talk").tag(VadMode.ptt)
                            Text("Hands-free").tag(VadMode.vad)
                        }
                        .pickerStyle(.segmented)
                        .frame(maxWidth: 260)
                    }

                    // Transcript
                    if !manager.transcript.isEmpty {
                        TranscriptView(entries: manager.transcript)
                            .frame(maxHeight: 300)
                    }

                    // GitHub digest card
                    if let digest = manager.toolDigest {
                        GitHubDigestCard(digest: digest)
                            .padding(.horizontal)
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 32)
            }
            .navigationTitle("Jarvis")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showHistory = true
                    } label: {
                        Image(systemName: "clock.arrow.circlepath")
                    }
                }
            }
            .sheet(isPresented: $showHistory) {
                NavigationStack {
                    SessionHistoryView()
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) {
                                Button("Done") { showHistory = false }
                            }
                        }
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

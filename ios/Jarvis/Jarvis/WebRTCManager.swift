import AVFoundation
import Combine
import Foundation
import WebRTC

enum VadMode: String {
    case ptt
    case vad
}

@MainActor
final class WebRTCManager: NSObject, ObservableObject {
    @Published var state: VoiceState = .disconnected
    @Published var transcript: [TranscriptEntry] = []
    @Published var vadMode: VadMode = .ptt
    @Published var toolDigest: GitHubDigest? = nil

    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        return RTCPeerConnectionFactory()
    }()

    private var peerConnection: RTCPeerConnection?
    private var dataChannel: RTCDataChannel?
    private var localAudioTrack: RTCAudioTrack?
    private var remoteAudioTrack: RTCAudioTrack?
    private var isSpeaking = false
    private var cancelled = false

    private let toolLabels: [String: String] = [
        "recall": "Searching memory",
        "get_weather": "Checking weather",
        "github": "Looking up GitHub",
        "capabilities": "Checking capabilities",
    ]

    // MARK: - Connect

    func connect() async {
        cleanup()
        cancelled = false
        state = .connecting
        transcript = []
        toolDigest = nil

        do {
            let session = try await APIClient.createSession()
            if cancelled { return }

            configureAudioSession()

            // Peer connection (no ICE servers — OpenAI handles ICE)
            let config = RTCConfiguration()
            let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
            guard let pc = Self.factory.peerConnection(
                with: config, constraints: constraints, delegate: self
            ) else {
                throw URLError(.cannotConnectToHost)
            }
            peerConnection = pc

            // Audio track (starts muted for PTT)
            let audioSource = Self.factory.audioSource(with: RTCMediaConstraints(
                mandatoryConstraints: nil,
                optionalConstraints: [
                    "echoCancellation": "true",
                    "autoGainControl": "true",
                    "noiseSuppression": "true",
                    "highpassFilter": "true",
                ]
            ))
            let audioTrack = Self.factory.audioTrack(with: audioSource, trackId: "audio0")
            audioTrack.isEnabled = false
            localAudioTrack = audioTrack
            pc.add(audioTrack, streamIds: ["local_stream"])

            // Data channel
            let dcConfig = RTCDataChannelConfiguration()
            guard let dc = pc.dataChannel(forLabel: "oai-events", configuration: dcConfig) else {
                throw URLError(.cannotConnectToHost)
            }
            dc.delegate = self
            dataChannel = dc

            // SDP offer
            let offerConstraints = RTCMediaConstraints(
                mandatoryConstraints: ["OfferToReceiveAudio": "true"],
                optionalConstraints: nil
            )
            let offer = try await pc.offer(for: offerConstraints)
            try await pc.setLocalDescription(offer)

            // SDP exchange with OpenAI GA endpoint
            var request = URLRequest(url: URL(string: "https://api.openai.com/v1/realtime/calls")!)
            request.httpMethod = "POST"
            request.setValue("Bearer \(session.ephemeralKey)", forHTTPHeaderField: "Authorization")
            request.setValue("application/sdp", forHTTPHeaderField: "Content-Type")
            request.httpBody = offer.sdp.data(using: .utf8)

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                let status = (response as? HTTPURLResponse)?.statusCode ?? -1
                print("[WebRTC] SDP exchange failed: \(status)")
                throw URLError(.badServerResponse)
            }

            if cancelled { return }

            // Extract callId from Location header (e.g. "/v1/realtime/calls/rtc_xxx")
            let callId: String? = http.value(forHTTPHeaderField: "Location").flatMap { location in
                guard let last = location.split(separator: "/").last, !last.isEmpty else { return nil }
                return String(last)
            }

            // Set remote description
            let answerSdp = String(data: data, encoding: .utf8) ?? ""
            let answer = RTCSessionDescription(type: .answer, sdp: answerSdp)
            try await pc.setRemoteDescription(answer)

            // Connect sideband for server-side tool execution
            if let callId {
                print("[WebRTC] callId: \(callId)")
                Task {
                    try? await APIClient.connectSideband(
                        callId: callId, ephemeralKey: session.ephemeralKey
                    )
                }
            } else {
                print("[WebRTC] No callId — sideband will not connect")
            }
        } catch {
            print("[WebRTC] Connection failed: \(error)")
            state = .error
            cleanup()
        }
    }

    // MARK: - Disconnect

    func disconnect() {
        cancelled = true
        cleanup()
        state = .disconnected
    }

    // MARK: - PTT

    func startTalking() {
        guard let dc = dataChannel, dc.readyState == .open,
              let track = localAudioTrack else { return }

        sendEvent(["type": "input_audio_buffer.clear"])

        if isSpeaking {
            sendEvent(["type": "response.cancel"])
            sendEvent(["type": "output_audio_buffer.clear"])
            isSpeaking = false
            finalizeTranscript()
        }

        track.isEnabled = true
        state = .listening
        appendTranscript("[speaking] ", role: .user)
    }

    func stopTalking() {
        guard let track = localAudioTrack else { return }
        track.isEnabled = false

        if let dc = dataChannel, dc.readyState == .open {
            sendEvent(["type": "input_audio_buffer.commit"])
            sendEvent(["type": "response.create"])
        }

        finalizeTranscript()
        state = .processing
    }

    // MARK: - VAD Toggle

    func setVadMode(_ mode: VadMode) {
        vadMode = mode
        guard let dc = dataChannel, dc.readyState == .open else { return }

        if mode == .vad {
            sendEvent([
                "type": "session.update",
                "session": [
                    "type": "realtime",
                    "audio": [
                        "input": [
                            "turn_detection": [
                                "type": "semantic_vad",
                                "eagerness": "auto",
                                "interrupt_response": true,
                                "create_response": true,
                            ] as [String: Any],
                        ] as [String: Any],
                    ] as [String: Any],
                ] as [String: Any],
            ])
            localAudioTrack?.isEnabled = true
        } else {
            sendEvent([
                "type": "session.update",
                "session": [
                    "type": "realtime",
                    "audio": [
                        "input": [
                            "turn_detection": NSNull(),
                        ] as [String: Any],
                    ] as [String: Any],
                ] as [String: Any],
            ])
            localAudioTrack?.isEnabled = false
        }
    }

    // MARK: - Private Helpers

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetoothA2DP])
            try session.setMode(.videoChat)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            print("[Audio] AVAudioSession setup failed: \(error)")
        }
    }

    private func cleanup() {
        peerConnection?.close()
        peerConnection = nil
        dataChannel = nil
        localAudioTrack = nil
        remoteAudioTrack = nil
        isSpeaking = false
    }

    private func sendEvent(_ dict: [String: Any]) {
        guard let dc = dataChannel, dc.readyState == .open,
              let json = try? JSONSerialization.data(withJSONObject: dict) else { return }
        dc.sendData(RTCDataBuffer(data: json, isBinary: false))
    }

    private func appendTranscript(_ text: String, role: TranscriptEntry.TranscriptRole) {
        if let last = transcript.last, last.role == role, !last.isFinal {
            transcript[transcript.count - 1].text += text
        } else {
            transcript.append(TranscriptEntry(role: role, text: text, isFinal: false))
        }
    }

    private func finalizeTranscript() {
        guard !transcript.isEmpty, !transcript[transcript.count - 1].isFinal else { return }
        transcript[transcript.count - 1].isFinal = true
    }

    // MARK: - Data Channel Event Handler

    private func handleServerEvent(data: Data) {
        guard let event = try? JSONDecoder().decode(RealtimeEvent.self, from: data) else {
            return
        }

        switch event.type {
        case "response.output_audio_transcript.delta":
            if !isSpeaking {
                isSpeaking = true
                state = .speaking
                remoteAudioTrack?.isEnabled = true
            }
            if let delta = event.delta {
                appendTranscript(delta, role: .assistant)
            }

        case "response.output_audio_transcript.done":
            finalizeTranscript()

        case "response.function_call_arguments.done":
            let toolName = event.name ?? "unknown"
            let label = toolLabels[toolName] ?? toolName
            transcript.append(TranscriptEntry(
                role: .tool, text: "\(label)...", isFinal: true, toolName: toolName
            ))
            if toolName != "github" { toolDigest = nil }
            state = .working

        case "response.done", "response.cancelled":
            isSpeaking = false
            state = .ready

        case "input_audio_buffer.speech_started":
            remoteAudioTrack?.isEnabled = false
            if isSpeaking {
                isSpeaking = false
                finalizeTranscript()
            }
            state = .listening

        case "input_audio_buffer.speech_stopped":
            if vadMode == .vad {
                finalizeTranscript()
                state = .processing
            }

        case "session.updated":
            print("[VAD] session.updated")

        case "conversation.item.created":
            if event.item?.type == "function_call_output", let output = event.item?.output {
                if let digest = parseGitHubDigest(output) {
                    toolDigest = digest
                }
            }

        case "error":
            print("[DC] Realtime error: \(event.error?.message ?? "unknown")")

        default:
            print("[DC unhandled] \(event.type)")
        }
    }

    // MARK: - GitHub Digest Parsing

    private func parseGitHubDigest(_ output: String) -> GitHubDigest? {
        guard let data = output.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        if raw["error"] is String { return nil }

        guard let evidence = raw["evidence"] as? [String: Any],
              let sourceType = evidence["sourceType"] as? String else {
            return nil
        }
        let sourceUrl = evidence["sourceUrl"] as? String

        switch sourceType {
        case "github_repo":
            return .repo(data: RepoDigest(
                name: raw["name"] as? String ?? "",
                description: raw["description"] as? String,
                language: raw["language"] as? String,
                stars: raw["stars"] as? Int ?? 0,
                forks: raw["forks"] as? Int ?? 0,
                openIssues: raw["openIssues"] as? Int ?? 0,
                topics: raw["topics"] as? [String] ?? []
            ), sourceUrl: sourceUrl)
        case "github_issue":
            return .issue(data: IssueDigest(
                title: raw["title"] as? String ?? "",
                state: raw["state"] as? String ?? "",
                author: raw["author"] as? String,
                commentCount: raw["commentCount"] as? Int ?? 0,
                labels: raw["labels"] as? [String] ?? []
            ), sourceUrl: sourceUrl)
        case "github_pull":
            return .pull(data: PullDigest(
                title: raw["title"] as? String ?? "",
                state: raw["state"] as? String ?? "",
                merged: raw["merged"] as? Bool ?? false,
                author: raw["author"] as? String,
                additions: raw["additions"] as? Int ?? 0,
                deletions: raw["deletions"] as? Int ?? 0,
                changedFiles: raw["changedFiles"] as? Int ?? 0,
                reviewCommentCount: raw["reviewCommentCount"] as? Int ?? 0
            ), sourceUrl: sourceUrl)
        case "github_file":
            return .file(data: FileDigest(
                path: raw["path"] as? String ?? "",
                size: raw["size"] as? Int ?? 0
            ), sourceUrl: sourceUrl)
        default:
            return nil
        }
    }
}

// MARK: - RTCPeerConnectionDelegate

extension WebRTCManager: RTCPeerConnectionDelegate {
    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState
    ) {
        print("[WebRTC] Signaling state: \(stateChanged.rawValue)")
    }

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream
    ) {
        let track = stream.audioTracks.first
        Task { @MainActor in
            self.remoteAudioTrack = track
            print("[WebRTC] Remote audio track added")
        }
    }

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream
    ) {}

    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState
    ) {
        print("[WebRTC] ICE connection state: \(newState.rawValue)")
        Task { @MainActor in
            if newState == .disconnected || newState == .failed {
                self.state = .disconnected
                self.cleanup()
            }
        }
    }

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState
    ) {
        print("[WebRTC] ICE gathering state: \(newState.rawValue)")
    }

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate
    ) {}

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]
    ) {}

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel
    ) {}
}

// MARK: - RTCDataChannelDelegate

extension WebRTCManager: RTCDataChannelDelegate {
    nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        let readyState = dataChannel.readyState
        print("[DC] Data channel state: \(readyState.rawValue)")
        Task { @MainActor in
            if readyState == .open {
                if self.cancelled { return }
                self.state = .ready
                if self.vadMode == .vad {
                    // Send session.update directly via captured dataChannel to avoid TOCTOU
                    let payload: [String: Any] = [
                        "type": "session.update",
                        "session": [
                            "type": "realtime",
                            "audio": [
                                "input": [
                                    "turn_detection": [
                                        "type": "semantic_vad",
                                        "eagerness": "auto",
                                        "interrupt_response": true,
                                        "create_response": true,
                                    ] as [String: Any],
                                ] as [String: Any],
                            ] as [String: Any],
                        ] as [String: Any],
                    ]
                    if let json = try? JSONSerialization.data(withJSONObject: payload) {
                        dataChannel.sendData(RTCDataBuffer(data: json, isBinary: false))
                    }
                    self.localAudioTrack?.isEnabled = true
                }
            } else if readyState == .closed {
                self.state = .disconnected
            }
        }
    }

    nonisolated func dataChannel(
        _ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer
    ) {
        let data = buffer.data
        Task { @MainActor in
            self.handleServerEvent(data: data)
        }
    }
}

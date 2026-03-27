import SwiftUI

struct PttButton: View {
    let disabled: Bool
    let isListening: Bool
    let onStart: () -> Void
    let onStop: () -> Void

    @State private var isPressed = false

    var body: some View {
        Circle()
            .fill(isPressed ? Color.red : Color.cyan.opacity(0.8))
            .frame(width: 80, height: 80)
            .overlay(
                Image(systemName: "mic.fill")
                    .font(.title)
                    .foregroundColor(.white)
            )
            .scaleEffect(isPressed ? 1.15 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: isPressed)
            .opacity(disabled ? 0.4 : 1.0)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !disabled, !isPressed else { return }
                        isPressed = true
                        onStart()
                    }
                    .onEnded { _ in
                        guard isPressed else { return }
                        isPressed = false
                        onStop()
                    }
            )
    }
}

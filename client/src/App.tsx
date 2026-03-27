import { useSession } from './hooks/useSession.ts';
import { StatusBadge } from './components/StatusBadge.tsx';
import { PttButton } from './components/PttButton.tsx';
import { Transcript } from './components/Transcript.tsx';
import { Orb } from './components/Orb.tsx';
import { VadToggle } from './components/VadToggle.tsx';

export function App() {
  const {
    state,
    transcript,
    vadMode,
    connect,
    disconnect,
    startTalking,
    stopTalking,
    setVadMode,
    micStream,
    remoteStream,
  } = useSession();

  const isConnected = state !== 'disconnected' && state !== 'error' && state !== 'connecting';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-950 p-4 text-gray-100">
      <h1 className="text-3xl font-semibold tracking-tight">Jarvis</h1>

      <Orb state={state} micStream={micStream} remoteStream={remoteStream} />

      <StatusBadge state={state} />

      <div className="flex gap-3">
        {state === 'disconnected' || state === 'error' ? (
          <button
            className="rounded-lg bg-cyan-700 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-600"
            onClick={connect}
          >
            Connect
          </button>
        ) : (
          <button
            className="rounded-lg bg-gray-700 px-6 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
            onClick={disconnect}
          >
            Disconnect
          </button>
        )}
      </div>

      {vadMode === 'ptt' && (
        <PttButton disabled={!isConnected} onStart={startTalking} onStop={stopTalking} />
      )}

      <VadToggle mode={vadMode} disabled={!isConnected} onChange={setVadMode} />

      <Transcript entries={transcript} />
    </div>
  );
}

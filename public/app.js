import {
  updateStatus,
  enablePTT,
  disablePTT,
  onReconnect,
  appendTranscript,
  finalizeTranscript,
} from './ui.js';

let pc = null;
let dc = null;
let micTrack = null;
let isSpeaking = false;
let audioEl = null;

async function init() {
  try {
    updateStatus('connecting');
    disablePTT();

    // Clean up previous connection if any
    if (pc) {
      pc.close();
      pc = null;
      dc = null;
    }
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      audioEl = null;
    }

    // 1. Fetch ephemeral key from our server
    const sessionRes = await fetch('/api/session', { method: 'POST' });
    if (!sessionRes.ok) {
      const err = await sessionRes.json();
      throw new Error(err.detail || err.error || 'Failed to create session');
    }
    const { ephemeralKey } = await sessionRes.json();

    // 2. Set up peer connection
    pc = new RTCPeerConnection();

    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    document.body.appendChild(audioEl);

    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
    };

    // 3. Monitor connection state for disconnection
    const localPc = pc;
    localPc.onconnectionstatechange = () => {
      if (localPc.connectionState === 'disconnected' || localPc.connectionState === 'failed') {
        updateStatus('disconnected');
      }
    };

    // 4. Add microphone track (start muted)
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micTrack = stream.getAudioTracks()[0];
    micTrack.enabled = false;
    pc.addTrack(micTrack, stream);

    // 5. Create data channel (must be named 'oai-events')
    dc = pc.createDataChannel('oai-events');
    setupDataChannel(dc);

    // 6. SDP offer → POST to OpenAI → get answer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        'Content-Type': 'application/sdp',
      },
      body: offer.sdp,
    });

    if (!sdpResponse.ok) {
      throw new Error(`SDP exchange failed: ${sdpResponse.status}`);
    }

    // 7. Extract call_id from Location header
    const location = sdpResponse.headers.get('Location');
    const callId = location ? location.split('/').pop() : null;

    // 8. Set remote description
    const answerSdp = await sdpResponse.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

    // 9. Connect sideband (server-side tool execution)
    if (callId) {
      const sbRes = await fetch('/api/session/sideband', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId }),
      });
      if (!sbRes.ok) {
        console.warn('Sideband connection failed — tools will not work');
      }
    }

    updateStatus('ready');
    enablePTT();
    setupPTT();
  } catch (err) {
    console.error('Init failed:', err);
    updateStatus('error');
  }
}

function setupDataChannel(channel) {
  channel.addEventListener('open', () => {
    console.log('Data channel open');
  });

  channel.addEventListener('message', (e) => {
    try {
      const event = JSON.parse(e.data);
      handleServerEvent(event);
    } catch {
      // Ignore unparseable messages
    }
  });

  channel.addEventListener('close', () => {
    console.log('Data channel closed');
    updateStatus('disconnected');
  });
}

function handleServerEvent(event) {
  switch (event.type) {
    case 'response.audio_transcript.delta':
      if (!isSpeaking) {
        isSpeaking = true;
        updateStatus('speaking');
      }
      appendTranscript(event.delta, 'assistant');
      break;

    case 'response.audio_transcript.done':
      finalizeTranscript();
      break;

    case 'response.function_call_arguments.done':
      updateStatus('working');
      break;

    case 'response.done':
      isSpeaking = false;
      updateStatus('ready');
      break;

    case 'input_audio_buffer.speech_started':
      updateStatus('listening');
      break;

    case 'error':
      console.error('Realtime error:', event.error);
      break;
  }
}

function setupPTT() {
  const btn = document.getElementById('ptt');

  const startTalking = () => {
    // Interrupt if Jarvis is speaking
    if (isSpeaking && dc?.readyState === 'open') {
      dc.send(JSON.stringify({ type: 'response.cancel' }));
      isSpeaking = false;
      finalizeTranscript();
    }

    micTrack.enabled = true;
    btn.classList.add('active');
    updateStatus('listening');
    appendTranscript('[speaking] ', 'user');
  };

  const stopTalking = () => {
    micTrack.enabled = false;
    btn.classList.remove('active');

    if (dc?.readyState === 'open') {
      dc.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      dc.send(JSON.stringify({ type: 'response.create' }));
    }

    finalizeTranscript();
    updateStatus('processing');
  };

  // Pointer events
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startTalking();
  });
  btn.addEventListener('pointerup', (e) => {
    e.preventDefault();
    stopTalking();
  });
  btn.addEventListener('pointerleave', () => {
    if (micTrack?.enabled) stopTalking();
  });

  // Keyboard: hold space to talk
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && !btn.disabled) {
      e.preventDefault();
      startTalking();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (micTrack?.enabled) stopTalking();
    }
  });
}

// Wire up reconnect button
onReconnect(() => {
  init();
});

init();

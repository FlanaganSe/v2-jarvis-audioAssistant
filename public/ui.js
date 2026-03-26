const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const pttBtn = document.getElementById('ptt');
const reconnectBtn = document.getElementById('reconnect');

const labels = {
  connecting: 'Connecting...',
  ready: 'Ready',
  listening: 'Listening...',
  processing: 'Processing...',
  working: 'Working...',
  speaking: 'Speaking...',
  error: 'Connection Error',
  disconnected: 'Disconnected',
};

export function updateStatus(state) {
  statusEl.textContent = labels[state] || state;
  statusEl.className = `status-${state}`;

  if (state === 'error' || state === 'disconnected') {
    reconnectBtn.style.display = 'inline-block';
    disablePTT();
  } else {
    reconnectBtn.style.display = 'none';
  }
}

export function enablePTT() {
  pttBtn.disabled = false;
}

export function disablePTT() {
  pttBtn.disabled = true;
}

export function onReconnect(callback) {
  reconnectBtn.addEventListener('click', callback);
}

export function appendTranscript(text, role) {
  let current = transcriptEl.querySelector('.current-message');
  if (!current || current.dataset.role !== role) {
    if (current) current.classList.remove('current-message');
    current = document.createElement('div');
    current.className = 'message current-message';
    current.dataset.role = role;
    transcriptEl.appendChild(current);
  }
  current.textContent += text;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

export function finalizeTranscript() {
  const current = transcriptEl.querySelector('.current-message');
  if (current) current.classList.remove('current-message');
}

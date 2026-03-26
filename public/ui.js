const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const pttBtn = document.getElementById('ptt');

export function updateStatus(state) {
  const labels = {
    connecting: 'Connecting...',
    ready: 'Ready',
    listening: 'Listening...',
    processing: 'Processing...',
    speaking: 'Speaking...',
    error: 'Error',
  };
  statusEl.textContent = labels[state] || state;
  statusEl.className = `status-${state}`;
}

export function enablePTT() {
  pttBtn.disabled = false;
}

export function disablePTT() {
  pttBtn.disabled = true;
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

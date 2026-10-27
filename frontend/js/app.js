/**
 * Saved Posts Getter — Frontend Application
 * Handles UI state, Socket.IO communication, and user interactions.
 */

const socket = io();

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const logTerminal = document.getElementById('logTerminal');
const clearLogsBtn = document.getElementById('clearLogs');
const downloadBtn = document.getElementById('downloadBtn');
const copyBtn = document.getElementById('copyBtn');
const resultsWrap = document.getElementById('resultsWrap');

const statButtons = document.getElementById('statButtons');
const statNew = document.getElementById('statNew');
const statDuplicates = document.getElementById('statDuplicates');
const statErrors = document.getElementById('statErrors');

let currentResults = null;
let automationRunning = false;

function init() {
  fetchStatus();
  setupEventListeners();
  setupSocketListeners();
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateStatusUI(data.status);
    if (data.logs) {
      data.logs.forEach(log => addLogEntry(log.message, log.type));
    }
    if (data.results) {
      currentResults = data.results;
      renderResults(data.results);
      updateStats(data.results);
    }
  } catch (e) {
    console.error('Failed to fetch status:', e);
  }
}

function setupSocketListeners() {
  socket.on('connect', () => {
    console.log('Connected to server');
  });

  socket.on('log', (log) => {
    addLogEntry(log.message, log.type);
  });

  socket.on('status', (data) => {
    updateStatusUI(data.status);
    if (data.results) {
      currentResults = data.results;
      renderResults(data.results);
      updateStats(data.results);
    }
  });
}

function setupEventListeners() {
  startBtn.addEventListener('click', startAutomation);
  stopBtn.addEventListener('click', stopAutomation);
  clearLogsBtn.addEventListener('click', clearLogs);
  downloadBtn.addEventListener('click', downloadResults);
  copyBtn.addEventListener('click', copyAllLinks);
}

async function startAutomation() {
  try {
    const res = await fetch('/api/start', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      automationRunning = true;
      updateStatusUI('running');
      startBtn.disabled = true;
      stopBtn.disabled = false;
      downloadBtn.disabled = true;
      copyBtn.disabled = true;
      clearResults();
    } else {
      alert(data.error || 'Failed to start automation');
    }
  } catch (e) {
    alert('Error starting automation: ' + e.message);
  }
}

async function stopAutomation() {
  try {
    await fetch('/api/stop', { method: 'POST' });
    automationRunning = false;
    updateStatusUI('idle');
    startBtn.disabled = false;
    stopBtn.disabled = true;
  } catch (e) {
    alert('Error stopping automation: ' + e.message);
  }
}

function updateStatusUI(status) {
  automationRunning = status === 'running';

  statusDot.className = 'dot';
  statusText.className = 'status-text';

  if (status === 'running') {
    statusDot.classList.add('dot-running');
    statusText.classList.add('running');
    statusText.textContent = 'Running';
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else if (status === 'completed') {
    statusDot.classList.add('dot-completed');
    statusText.classList.add('completed');
    statusText.textContent = 'Completed';
    startBtn.disabled = false;
    stopBtn.disabled = true;
    downloadBtn.disabled = false;
    copyBtn.disabled = false;
  } else if (status === 'error') {
    statusDot.classList.add('dot-error');
    statusText.classList.add('error');
    statusText.textContent = 'Error';
    startBtn.disabled = false;
    stopBtn.disabled = true;
  } else {
    statusDot.classList.add('dot-idle');
    statusText.textContent = 'Idle';
    startBtn.disabled = false;
    stopBtn.disabled = true;
    downloadBtn.disabled = true;
    copyBtn.disabled = true;
  }
}

function addLogEntry(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = message;
  logTerminal.appendChild(entry);
  logTerminal.scrollTop = logTerminal.scrollHeight;

  const empty = logTerminal.querySelector('.log-empty');
  if (empty) empty.remove();
}

function clearLogs() {
  logTerminal.innerHTML = '<div class="log-empty">Logs cleared. Waiting for new output...</div>';
}

function clearResults() {
  resultsWrap.innerHTML = '<div class="results-empty">Running automation&hellip;</div>';
  currentResults = null;
  updateStats(null);
}

function renderResults(results) {
  if (!results || !results.links || results.links.length === 0) {
    resultsWrap.innerHTML = '<div class="results-empty">No links extracted.</div>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'results-table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th style="width: 40px;">#</th>
      <th>Post Link</th>
      <th style="width: 160px;">Actions</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  results.links.forEach((link, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td class="link-cell" title="${link}">${link}</td>
      <td class="actions-cell">
        <button class="btn-copy-link" data-link="${link}">Copy</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  resultsWrap.innerHTML = '';
  resultsWrap.appendChild(table);

  table.querySelectorAll('.btn-copy-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const link = e.target.getAttribute('data-link');
      copyToClipboard(link);
      e.target.textContent = 'Copied!';
      setTimeout(() => e.target.textContent = 'Copy', 1500);
    });
  });
}

async function copyAllLinks() {
  if (!currentResults || !currentResults.links) return;
  const links = currentResults.links.join('\n');
  await copyToClipboard(links);
  copyBtn.textContent = 'Copied!';
  setTimeout(() => copyBtn.textContent = 'Copy All', 1500);
}

function downloadResults() {
  fetch('/api/download')
    .then(res => {
      if (!res.ok) throw new Error('No file to download');
      return res.blob();
    })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'saved-post-links.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch(e => alert('Error downloading: ' + e.message));
}

function updateStats(results) {
  if (!results) {
    statButtons.textContent = '0';
    statNew.textContent = '0';
    statDuplicates.textContent = '0';
    statErrors.textContent = '0';
    return;
  }
  statButtons.textContent = results.total || 0;
  statNew.textContent = results.total || 0;
  statDuplicates.textContent = '0';
  statErrors.textContent = '0';
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

init();

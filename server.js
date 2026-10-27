/**
 * LinkedIn Saved Posts Getter - Backend Server
 * Express.js server that wraps the Playwright automation script
 * Provides API endpoints to start/stop automation and retrieve results
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const SCRIPT_PATH = path.join(__dirname, 'saved-post-getter.js');
const OUTPUT_FILE = path.join(__dirname, 'output', 'saved-post-links.json');

let automationProcess = null;
let automationStatus = 'idle';
let automationLogs = [];
let automationResults = null;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

function addLog(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, message, type };
  automationLogs.push(logEntry);
  if (automationLogs.length > 500) automationLogs.shift();
  io.emit('log', logEntry);
  console.log(`[${type.toUpperCase()}] ${message}`);
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.get('/api/status', (req, res) => {
  res.json({
    status: automationStatus,
    logs: automationLogs.slice(-50),
    results: automationResults
  });
});

app.post('/api/start', (req, res) => {
  if (automationStatus === 'running') {
    return res.status(409).json({ error: 'Automation already running' });
  }

  automationStatus = 'running';
  automationLogs = [];
  automationResults = null;
  addLog('Starting LinkedIn Saved Posts Getter...', 'info');

  automationProcess = spawn('node', [SCRIPT_PATH], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  automationProcess.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      text.split('\n').forEach(line => {
        if (line.trim()) addLog(line.trim(), 'info');
      });
    }
  });

  automationProcess.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      text.split('\n').forEach(line => {
        if (line.trim()) addLog(line.trim(), 'error');
      });
    }
  });

  automationProcess.on('close', (code) => {
    automationProcess = null;
    if (code === 0) {
      automationStatus = 'completed';
      addLog('Automation completed successfully.', 'success');
      try {
        if (fs.existsSync(OUTPUT_FILE)) {
          automationResults = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
          addLog(`Loaded ${automationResults.total} saved post link(s).`, 'success');
        }
      } catch (e) {
        addLog(`Could not read results: ${e.message}`, 'error');
      }
    } else {
      automationStatus = 'error';
      addLog(`Automation exited with code ${code}`, 'error');
    }
    io.emit('status', { status: automationStatus, results: automationResults });
  });

  io.emit('status', { status: automationStatus });
  res.json({ success: true, status: automationStatus });
});

app.post('/api/stop', (req, res) => {
  if (automationProcess) {
    automationProcess.kill();
    automationProcess = null;
    automationStatus = 'idle';
    addLog('Automation stopped by user.', 'warn');
    io.emit('status', { status: automationStatus });
  }
  res.json({ success: true });
});

app.get('/api/results', (req, res) => {
  if (automationResults) {
    res.json(automationResults);
  } else {
    try {
      if (fs.existsSync(OUTPUT_FILE)) {
        const data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
        res.json(data);
      } else {
        res.status(404).json({ error: 'No results found' });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
});

app.get('/api/download', (req, res) => {
  if (fs.existsSync(OUTPUT_FILE)) {
    res.download(OUTPUT_FILE, 'saved-post-links.json');
  } else {
    res.status(404).json({ error: 'No results file found' });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

module.exports = { app, server, io };

// CLI P2P Chat — Browser Demo
// Simulates a P2P TCP/IP chat interface in the browser

const state = {
  connected: false,
  hosting: false,
  username: 'guest',
  peer: null,
  port: null,
  peers: [],
  history: [],
  historyIdx: -1,
  latency: null,
};

const HELP = `
<span style="color:var(--green)">Comandos disponíveis:</span>
  /host [porta]       — inicia servidor na porta (padrão: 8080)
  /connect [ip:porta] — conecta a um peer
  /nick [nome]        — define seu nome de usuário
  /peers              — lista peers conectados
  /ping               — mede latência simulada
  /clear              — limpa o terminal
  /disconnect         — encerra a conexão
  /help               — exibe esta ajuda
  /about              — sobre o projeto

<span style="color:var(--text-dim)">Fora de um comando, mensagens são enviadas ao peer atual.</span>
`.trim();

const ABOUT = `
<span style="color:var(--green)">CLI P2P Chat</span> — versão web demo

Chat P2P descentralizado sem servidor central.
Comunicação direta via TCP/IP e UDP sockets.

Protocolo original: Python · TCP/IP · UDP
Esta versão: simulação interativa no browser.
`.trim();

const DEMO_PEERS = ['Alice@192.168.1.10', 'Bob@10.0.0.5'];
const DEMO_MSGS = [
  'ei, tudo bem?',
  'a conexão tá estável hoje',
  'mandei os arquivos via UDP',
  'latência baixa aqui, ~12ms',
  'vamos testar o broadcast',
];

function now() {
  return new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
}

function log(html, type = 'system') {
  const out = document.getElementById('output');
  const div = document.createElement('div');
  div.className = `msg ${type}`;
  div.innerHTML = html;
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}

function logSystem(text, cls = '') {
  log(`<span class="author">system</span><span class="text">${text}</span><span class="time">${now()}</span>`, `system ${cls}`);
}

function logMsg(author, text, type = 'received') {
  log(`<span class="author">[${author}]</span><span class="text">${text}</span><span class="time">${now()}</span>`, `msg ${type}`);
}

function setStatus(online, mode = '') {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  dot.className = 'status-dot' + (online ? (mode === 'host' ? ' hosting' : ' online') : '');
  txt.textContent = online ? (mode === 'host' ? 'hosting' : 'connected') : 'offline';
  document.getElementById('infoMode').textContent = online ? (mode === 'host' ? 'server' : 'client') : 'idle';
}

function renderPeers() {
  const list = document.getElementById('peerList');
  if (!state.peers.length) {
    list.innerHTML = '<div class="peer-item no-peers">nenhum peer conectado</div>';
    return;
  }
  list.innerHTML = state.peers.map(p => `<div class="peer-item connected">${p}</div>`).join('');
}

function simulatePeerMessage() {
  if (!state.connected && !state.hosting) return;
  const delay = 1500 + Math.random() * 4000;
  setTimeout(() => {
    if (!state.connected && !state.hosting) return;
    const peer = state.peers[0] || 'peer';
    const msg = DEMO_MSGS[Math.floor(Math.random() * DEMO_MSGS.length)];
    logMsg(peer.split('@')[0], msg, 'received');
    simulatePeerMessage();
  }, delay);
}

function simulateLatency() {
  return Math.floor(8 + Math.random() * 30) + 'ms';
}

function handleCommand(cmd) {
  const parts = cmd.trim().split(/\s+/);
  const base = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ');

  switch (base) {
    case '/help':
      log(HELP, 'system info');
      break;

    case '/about':
      log(ABOUT, 'system info');
      break;

    case '/host': {
      if (state.connected) return logSystem('Desconecte primeiro (/disconnect).', 'warn');
      const port = parseInt(arg) || 8080;
      state.hosting = true;
      state.port = port;
      state.peers = [DEMO_PEERS[0]];
      document.getElementById('infoPort').textContent = port;
      document.getElementById('infoLatency').textContent = simulateLatency();
      setStatus(true, 'host');
      renderPeers();
      logSystem(`Servidor iniciado na porta <strong>${port}</strong>. Aguardando conexões...`, 'success');
      setTimeout(() => {
        logSystem(`Peer conectado: <strong>${DEMO_PEERS[0]}</strong>`, 'success');
        simulatePeerMessage();
      }, 1200);
      break;
    }

    case '/connect': {
      if (state.connected || state.hosting) return logSystem('Desconecte primeiro (/disconnect).', 'warn');
      const target = arg || document.getElementById('peerInput').value.trim() || '192.168.1.10:8080';
      logSystem(`Conectando a <strong>${target}</strong>...`);
      setTimeout(() => {
        state.connected = true;
        state.peer = target;
        state.port = target.split(':')[1] || '8080';
        state.peers = [target.includes('@') ? target : `peer@${target}`];
        document.getElementById('infoPort').textContent = state.port;
        document.getElementById('infoLatency').textContent = simulateLatency();
        setStatus(true, 'client');
        renderPeers();
        logSystem(`Conectado a <strong>${target}</strong> via TCP/IP`, 'success');
        document.getElementById('inputPrompt').textContent = `${state.username}@p2p:~$`;
        simulatePeerMessage();
      }, 800 + Math.random() * 600);
      break;
    }

    case '/disconnect':
      if (!state.connected && !state.hosting) return logSystem('Não há conexão ativa.', 'warn');
      state.connected = false;
      state.hosting = false;
      state.peers = [];
      state.port = null;
      document.getElementById('infoPort').textContent = '—';
      document.getElementById('infoLatency').textContent = '—';
      setStatus(false);
      renderPeers();
      logSystem('Conexão encerrada.', 'warn');
      break;

    case '/nick':
      if (!arg) return logSystem('Uso: /nick [nome]', 'warn');
      state.username = arg;
      document.getElementById('inputPrompt').textContent = `${state.username}@p2p:~$`;
      logSystem(`Nick definido: <strong>${arg}</strong>`, 'success');
      break;

    case '/peers':
      if (!state.peers.length) return logSystem('Nenhum peer conectado.', 'warn');
      logSystem(`Peers: ${state.peers.join(', ')}`, 'info');
      break;

    case '/ping': {
      const lat = simulateLatency();
      document.getElementById('infoLatency').textContent = lat;
      logSystem(`PONG — latência: <strong>${lat}</strong>`, 'success');
      break;
    }

    case '/clear':
      document.getElementById('output').innerHTML = '';
      break;

    default:
      logSystem(`Comando desconhecido: <em>${base}</em>. Digite /help.`, 'error');
  }
}

function sendMessage(text) {
  if (!text.trim()) return;
  if (text.startsWith('/')) {
    handleCommand(text);
  } else {
    if (!state.connected && !state.hosting) {
      logSystem('Conecte-se primeiro: /connect [ip:porta] ou /host', 'warn');
      return;
    }
    logMsg(state.username, text, 'sent');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('msgInput');

  // Intro
  logSystem('CLI P2P Chat — demo interativo', 'info');
  logSystem('Digite /help para ver os comandos disponíveis.', '');
  logSystem('Tente: /host · /connect 192.168.1.10:8080 · /nick seunome', '');

  document.getElementById('sendBtn').addEventListener('click', () => {
    const val = input.value.trim();
    if (!val) return;
    state.history.unshift(val);
    state.historyIdx = -1;
    sendMessage(val);
    input.value = '';
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = input.value.trim();
      if (!val) return;
      state.history.unshift(val);
      state.historyIdx = -1;
      sendMessage(val);
      input.value = '';
    }
    if (e.key === 'ArrowUp') {
      state.historyIdx = Math.min(state.historyIdx + 1, state.history.length - 1);
      input.value = state.history[state.historyIdx] || '';
    }
    if (e.key === 'ArrowDown') {
      state.historyIdx = Math.max(state.historyIdx - 1, -1);
      input.value = state.historyIdx < 0 ? '' : state.history[state.historyIdx];
    }
  });

  document.getElementById('connectBtn').addEventListener('click', () => {
    const val = document.getElementById('peerInput').value.trim();
    handleCommand(`/connect ${val}`);
  });

  document.getElementById('hostBtn').addEventListener('click', () => {
    handleCommand('/host 8080');
  });
});

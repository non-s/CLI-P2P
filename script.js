const SUPABASE_URL      = 'https://bvquyfzllqnbfxncsacn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2cXV5ZnpsbHFuYmZ4bmNzYWNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxODU1MzQsImV4cCI6MjA5Mzc2MTUzNH0.xa_rs4bVLoTv58P7U8rDOaPjo1Dqt60q8cR-IWFpbug';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];

const state = {
    pc: null,
    channel: null,
    rtChannel: null,
    roomCode: null,
    connected: false,
    username: 'guest',
    history: [],
    historyIdx: -1,
    demoMode: false,
};

/* ── DOM ── */
const output      = document.getElementById('output');
const msgInput    = document.getElementById('msgInput');
const sendBtn     = document.getElementById('sendBtn');
const statusDot   = document.getElementById('statusDot');
const statusText  = document.getElementById('statusText');
const infoMode    = document.getElementById('infoMode');
const infoIce     = document.getElementById('infoIce');
const inputPrompt = document.getElementById('inputPrompt');

const roomCodeSection = document.getElementById('roomCodeSection');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const joinSection     = document.getElementById('joinSection');
const roomCodeInput   = document.getElementById('roomCodeInput');
const btnConfirmJoin  = document.getElementById('btnConfirmJoin');

/* ── Log ── */
function now() {
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function log(parts, cls = 'system') {
    const div = document.createElement('div');
    div.className = `msg ${cls}`;
    div.innerHTML = parts;
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
}

function logSystem(text, variant = '') {
    log(`<span class="text">${text}</span><span class="time">${now()}</span>`, `system ${variant}`);
}

function logMsg(author, text, type = 'received') {
    log(`<span class="author">[${author}]</span><span class="text">${text}</span><span class="time">${now()}</span>`, `msg ${type}`);
}

/* ── Status ── */
function setStatus(s) {
    const map = {
        idle:       { dot: '',           text: 'desconectado',    mode: 'idle' },
        connecting: { dot: 'connecting', text: 'conectando...',   mode: 'handshake' },
        connected:  { dot: 'connected',  text: 'conectado (P2P)', mode: 'datachannel' },
        failed:     { dot: '',           text: 'falha',           mode: 'erro' },
        demo:       { dot: 'connected',  text: 'demo mode',       mode: 'simulado' },
    };
    const m = map[s] || map.idle;
    statusDot.className    = `status-dot ${m.dot}`;
    statusText.textContent = m.text;
    infoMode.textContent   = m.mode;
}

/* ── Helpers ── */
function genCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function createPC() {
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pc.oniceconnectionstatechange = () => {
        infoIce.textContent = pc.iceConnectionState;
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            setStatus('connected');
            state.connected = true;
            logSystem('Canal P2P estabelecido via WebRTC DataChannel.', 'success');
            logSystem('Criptografia DTLS-SRTP ativa. Sem servidor intermediário.', 'info');
            if (state.rtChannel) {
                sb.removeChannel(state.rtChannel);
                state.rtChannel = null;
            }
        }
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            setStatus('failed');
            state.connected = false;
            logSystem('Conexão encerrada ou falhou.', 'warn');
        }
    };
    return pc;
}

function waitForICE(pc) {
    return new Promise(resolve => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        const handler = () => {
            if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', handler);
                resolve();
            }
        };
        pc.addEventListener('icegatheringstatechange', handler);
        setTimeout(resolve, 4000);
    });
}

function setupChannel(ch) {
    state.channel = ch;
    ch.onopen = () => {
        setStatus('connected');
        state.connected = true;
        logSystem('Canal aberto. Pode enviar mensagens agora.', 'success');
        roomCodeSection.style.display = 'none';
        joinSection.style.display = 'none';
    };
    ch.onclose = () => {
        state.connected = false;
        setStatus('idle');
        logSystem('Canal encerrado pelo peer.', 'warn');
    };
    ch.onmessage = e => {
        try {
            const { author, text } = JSON.parse(e.data);
            logMsg(author || 'peer', text);
        } catch {
            logMsg('peer', e.data);
        }
    };
    ch.onerror = () => logSystem('Erro no canal de dados.', 'error');
}

/* ── Criar Sala (Peer A) ── */
async function createRoom() {
    resetConnection();
    state.roomCode = genCode();
    state.pc = createPC();

    const ch = state.pc.createDataChannel('chat', { ordered: true });
    setupChannel(ch);

    setStatus('connecting');
    logSystem('Gerando sala... aguarde o ICE gathering.', 'info');

    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    await waitForICE(state.pc);
    const localDesc = state.pc.localDescription;

    roomCodeDisplay.textContent = state.roomCode;
    roomCodeSection.style.display = 'block';
    joinSection.style.display = 'none';

    state.rtChannel = sb.channel(`p2p-${state.roomCode}`, {
        config: { broadcast: { self: false } },
    });

    /* Peer B chegou tarde: reenvia a oferta */
    state.rtChannel.on('broadcast', { event: 'request-offer' }, () => {
        state.rtChannel.send({ type: 'broadcast', event: 'offer', payload: { sdp: localDesc } });
    });

    state.rtChannel.on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (!state.pc || state.pc.signalingState !== 'have-local-offer') return;
        await state.pc.setRemoteDescription(payload.sdp);
        logSystem('Resposta recebida. Aguardando ICE...', 'info');
    });

    state.rtChannel.subscribe(() => {
        /* Publica oferta inicial ao se inscrever */
        state.rtChannel.send({ type: 'broadcast', event: 'offer', payload: { sdp: localDesc } });
        logSystem(`Sala criada: <strong>${state.roomCode}</strong>. Compartilhe o código com o outro peer.`, 'success');
    });
}

/* ── Entrar na Sala (Peer B) ── */
async function joinRoom() {
    const code = roomCodeInput.value.trim().replace(/\D/g, '');
    if (code.length !== 6) {
        logSystem('Digite o código de 6 dígitos da sala.', 'warn');
        return;
    }

    resetConnection();
    state.pc = createPC();
    state.pc.ondatachannel = e => setupChannel(e.channel);

    setStatus('connecting');
    logSystem(`Conectando à sala ${code}...`, 'info');

    state.rtChannel = sb.channel(`p2p-${code}`, {
        config: { broadcast: { self: false } },
    });

    state.rtChannel.on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (!state.pc || state.pc.signalingState !== 'stable') return;
        await state.pc.setRemoteDescription(payload.sdp);
        const answer = await state.pc.createAnswer();
        await state.pc.setLocalDescription(answer);
        await waitForICE(state.pc);
        state.rtChannel.send({ type: 'broadcast', event: 'answer', payload: { sdp: state.pc.localDescription } });
        logSystem('Resposta enviada. Aguardando ICE...', 'info');
    });

    state.rtChannel.subscribe(() => {
        /* Solicita oferta caso Peer A já tenha publicado antes */
        state.rtChannel.send({ type: 'broadcast', event: 'request-offer', payload: {} });
    });
}

function resetConnection() {
    if (state.rtChannel) {
        sb.removeChannel(state.rtChannel);
        state.rtChannel = null;
    }
    if (state.pc) {
        state.pc.close();
        state.pc = null;
        state.channel = null;
        state.connected = false;
    }
    setStatus('idle');
}

/* ── Demo ── */
const DEMO_MSGS = [
    'ei, testando a conexão',
    'latência baixa aqui',
    'o canal DTLS está criptografado',
    'sem servidor no meio — P2P direto',
    'WebRTC é subestimado para isso',
];

let demoInterval = null;

function startDemo() {
    if (state.demoMode) return;
    state.demoMode = true;
    state.connected = true;
    setStatus('demo');
    logSystem('Modo demo ativo — mensagens simuladas.', 'info');
    logSystem('Para P2P real, use "Criar Sala" com outro browser.', '');
    let i = 0;
    demoInterval = setInterval(() => {
        logMsg('demo-peer', DEMO_MSGS[i % DEMO_MSGS.length]);
        i++;
    }, 3500 + Math.random() * 2000);
}

function stopDemo() {
    if (!state.demoMode) return;
    clearInterval(demoInterval);
    demoInterval = null;
    state.demoMode = false;
    state.connected = false;
    setStatus('idle');
    logSystem('Modo demo encerrado.', 'warn');
}

/* ── Comandos ── */
const HELP = `<span style="color:var(--blue)">Comandos:</span>
  /nick [nome]    — define seu nome de usuário
  /demo           — inicia modo demo (sem peer real)
  /stopdemo       — encerra o modo demo
  /clear          — limpa o terminal
  /help           — esta ajuda

<span style="color:var(--text-dim)">Para chat real: "Criar Sala" → compartilhe o código de 6 dígitos.</span>`.trim();

function handleCommand(cmd) {
    const [base, ...args] = cmd.trim().split(/\s+/);
    const arg = args.join(' ');
    switch (base.toLowerCase()) {
        case '/help':     log(HELP, 'system info'); break;
        case '/nick':
            if (!arg) return logSystem('Uso: /nick [nome]', 'warn');
            state.username = arg;
            inputPrompt.textContent = `${state.username}@p2p:~$`;
            logSystem(`Nick definido: <strong>${arg}</strong>`, 'success');
            break;
        case '/clear':    output.innerHTML = ''; break;
        case '/demo':     startDemo(); break;
        case '/stopdemo': stopDemo(); break;
        default: logSystem(`Comando desconhecido: <em>${base}</em>. Digite /help.`, 'error');
    }
}

function sendMessage(text) {
    if (!text.trim()) return;
    if (text.startsWith('/')) { handleCommand(text); return; }
    if (!state.connected) {
        logSystem('Sem conexão ativa. Use "Criar Sala", "Entrar na Sala" ou /demo.', 'warn');
        return;
    }
    if (state.demoMode) { logMsg(state.username, text, 'sent'); return; }
    if (state.channel && state.channel.readyState === 'open') {
        state.channel.send(JSON.stringify({ author: state.username, text }));
        logMsg(state.username, text, 'sent');
    } else {
        logSystem('Canal não está pronto.', 'warn');
    }
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
    const webRTCSupported = typeof RTCPeerConnection !== 'undefined';

    logSystem('P2P Chat — WebRTC DataChannel + Supabase Realtime', 'info');
    if (webRTCSupported) {
        logSystem('WebRTC disponível. Crie uma sala ou entre numa com o código.', 'success');
        logSystem('Ou digite /demo para testar sem um peer real.', '');
    } else {
        logSystem('WebRTC não disponível neste ambiente.', 'warn');
        logSystem('Use /demo para ver a interface em funcionamento.', '');
    }

    document.getElementById('btnCreateRoom').addEventListener('click', () => {
        if (!webRTCSupported) return logSystem('WebRTC não suportado.', 'error');
        joinSection.style.display = 'none';
        createRoom();
    });

    document.getElementById('btnJoinRoom').addEventListener('click', () => {
        if (!webRTCSupported) return logSystem('WebRTC não suportado.', 'error');
        roomCodeSection.style.display = 'none';
        joinSection.style.display = 'block';
        roomCodeInput.focus();
    });

    btnConfirmJoin.addEventListener('click', joinRoom);

    roomCodeInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') joinRoom();
    });

    document.getElementById('btnCopyCode').addEventListener('click', () => {
        const code = roomCodeDisplay.textContent;
        if (!code) return;
        navigator.clipboard.writeText(code).then(() => {
            const btn = document.getElementById('btnCopyCode');
            const orig = btn.textContent;
            btn.textContent = '✓ Copiado!';
            setTimeout(() => { btn.textContent = orig; }, 1500);
        });
    });

    sendBtn.addEventListener('click', () => {
        const val = msgInput.value.trim();
        if (!val) return;
        state.history.unshift(val);
        state.historyIdx = -1;
        sendMessage(val);
        msgInput.value = '';
    });

    msgInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            const val = msgInput.value.trim();
            if (!val) return;
            state.history.unshift(val);
            state.historyIdx = -1;
            sendMessage(val);
            msgInput.value = '';
        }
        if (e.key === 'ArrowUp') {
            state.historyIdx = Math.min(state.historyIdx + 1, state.history.length - 1);
            msgInput.value = state.history[state.historyIdx] || '';
            e.preventDefault();
        }
        if (e.key === 'ArrowDown') {
            state.historyIdx = Math.max(state.historyIdx - 1, -1);
            msgInput.value = state.historyIdx < 0 ? '' : state.history[state.historyIdx];
        }
    });
});

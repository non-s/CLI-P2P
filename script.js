/*
 * P2P Chat — WebRTC DataChannel
 *
 * Fluxo real de conexão (sem servidor de sinalização):
 *   Peer A: cria oferta SDP  →  compartilha código
 *   Peer B: recebe oferta    →  gera resposta SDP  →  compartilha código
 *   Peer A: recebe resposta  →  conexão ICE estabelecida
 *   Canal DTLS-SRTP ativo — comunicação direta entre browsers.
 *
 * Fallback: modo demo para ambientes sem WebRTC.
 */

const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];

/* ── Estado ── */
const state = {
    pc: null,
    channel: null,
    role: null,           // 'offerer' | 'answerer'
    connected: false,
    username: 'guest',
    history: [],
    historyIdx: -1,
    demoMode: false,
};

/* ── DOM ── */
const output     = document.getElementById('output');
const msgInput   = document.getElementById('msgInput');
const sendBtn    = document.getElementById('sendBtn');
const statusDot  = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const infoMode   = document.getElementById('infoMode');
const infoIce    = document.getElementById('infoIce');
const inputPrompt = document.getElementById('inputPrompt');

const sdpSection  = document.getElementById('sdpSection');
const sdpLabel    = document.getElementById('sdpLabel');
const sdpOutput   = document.getElementById('sdpOutput');
const sdpInput    = document.getElementById('sdpInput');
const btnCopySDP  = document.getElementById('btnCopySDP');
const btnConfirm  = document.getElementById('btnConfirm');

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
    log(`<span class="text">${text}</span><span class="time">${now()}</span>`,
        `system ${variant}`);
}

function logMsg(author, text, type = 'received') {
    log(`<span class="author">[${author}]</span><span class="text">${text}</span><span class="time">${now()}</span>`,
        `msg ${type}`);
}

/* ── Status UI ── */
function setStatus(state_) {
    const map = {
        idle:         { dot: '',           text: 'desconectado',   mode: 'idle' },
        connecting:   { dot: 'connecting', text: 'conectando...',  mode: 'handshake' },
        connected:    { dot: 'connected',  text: 'conectado (P2P)', mode: 'datachannel' },
        failed:       { dot: '',           text: 'falha',          mode: 'erro' },
        demo:         { dot: 'connected',  text: 'demo mode',      mode: 'simulado' },
    };
    const s = map[state_] || map.idle;
    statusDot.className  = `status-dot ${s.dot}`;
    statusText.textContent = s.text;
    infoMode.textContent   = s.mode;
}

/* ── WebRTC Core ── */
function createPC() {
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });

    pc.oniceconnectionstatechange = () => {
        infoIce.textContent = pc.iceConnectionState;
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            setStatus('connected');
            state.connected = true;
            logSystem('Canal P2P estabelecido via WebRTC DataChannel.', 'success');
            logSystem('Criptografia DTLS-SRTP ativa. Sem servidor intermediário.', 'info');
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
    return new Promise((resolve) => {
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
        sdpSection.style.display = 'none';
    };

    ch.onclose = () => {
        state.connected = false;
        setStatus('idle');
        logSystem('Canal encerrado pelo peer.', 'warn');
    };

    ch.onmessage = (e) => {
        try {
            const { author, text } = JSON.parse(e.data);
            logMsg(author || 'peer', text);
        } catch {
            logMsg('peer', e.data);
        }
    };

    ch.onerror = () => logSystem('Erro no canal de dados.', 'error');
}

/* ── Criar Oferta (Peer A) ── */
async function createOffer() {
    resetConnection();
    state.role = 'offerer';
    state.pc = createPC();

    const ch = state.pc.createDataChannel('chat', { ordered: true });
    setupChannel(ch);

    setStatus('connecting');
    logSystem('Gerando oferta SDP (aguarde o ICE gathering)...', 'info');

    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    await waitForICE(state.pc);

    const code = btoa(JSON.stringify(state.pc.localDescription));
    sdpOutput.value = code;
    sdpLabel.textContent = '// código de oferta (envie ao Peer B)';
    sdpSection.style.display = 'block';

    btnConfirm.textContent = 'Confirmar Resposta';
    btnConfirm.onclick = confirmAnswer;

    logSystem('Código de oferta gerado. Copie e envie ao outro peer.', 'success');
    logSystem('Após o Peer B gerar a resposta, cole-a abaixo e clique "Confirmar Resposta".', '');
}

/* ── Criar Resposta (Peer B) ── */
async function joinSession() {
    const offerCode = sdpInput.value.trim();
    if (!offerCode) {
        logSystem('Cole o código de oferta antes.', 'warn');
        return;
    }

    resetConnection();
    state.role = 'answerer';
    state.pc = createPC();

    state.pc.ondatachannel = (e) => setupChannel(e.channel);

    setStatus('connecting');
    logSystem('Processando oferta e gerando resposta...', 'info');

    try {
        const offer = JSON.parse(atob(offerCode));
        await state.pc.setRemoteDescription(offer);
        const answer = await state.pc.createAnswer();
        await state.pc.setLocalDescription(answer);
        await waitForICE(state.pc);

        const code = btoa(JSON.stringify(state.pc.localDescription));
        sdpOutput.value = code;
        sdpLabel.textContent = '// código de resposta (envie ao Peer A)';

        btnConfirm.textContent = 'Aguardando conexão...';
        btnConfirm.disabled = true;

        logSystem('Resposta gerada. Copie e envie de volta ao Peer A.', 'success');
        logSystem('A conexão será estabelecida automaticamente após o Peer A confirmar.', '');
    } catch {
        logSystem('Código de oferta inválido. Verifique e tente novamente.', 'error');
        setStatus('idle');
    }
}

/* ── Confirmar Resposta (Peer A) ── */
async function confirmAnswer() {
    const answerCode = sdpInput.value.trim();
    if (!answerCode) {
        logSystem('Cole o código de resposta do Peer B.', 'warn');
        return;
    }
    try {
        const answer = JSON.parse(atob(answerCode));
        await state.pc.setRemoteDescription(answer);
        logSystem('Resposta aceita. Estabelecendo conexão ICE...', 'info');
        btnConfirm.disabled = true;
    } catch {
        logSystem('Código de resposta inválido.', 'error');
    }
}

function resetConnection() {
    if (state.pc) {
        state.pc.close();
        state.pc = null;
        state.channel = null;
        state.connected = false;
    }
    sdpOutput.value = '';
    sdpInput.value  = '';
    btnConfirm.disabled = false;
    setStatus('idle');
}

/* ── Modo Demo ── */
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
    logSystem('Para P2P real, use "Criar Sessão" com outro browser.', '');
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

<span style="color:var(--text-dim)">Para chat real: use os botões "Criar Sessão" / "Entrar na Sessão" na barra lateral.</span>`.trim();

function handleCommand(cmd) {
    const [base, ...args] = cmd.trim().split(/\s+/);
    const arg = args.join(' ');

    switch (base.toLowerCase()) {
        case '/help':
            log(HELP, 'system info');
            break;
        case '/nick':
            if (!arg) return logSystem('Uso: /nick [nome]', 'warn');
            state.username = arg;
            inputPrompt.textContent = `${state.username}@p2p:~$`;
            logSystem(`Nick definido: <strong>${arg}</strong>`, 'success');
            break;
        case '/clear':
            output.innerHTML = '';
            break;
        case '/demo':
            startDemo();
            break;
        case '/stopdemo':
            stopDemo();
            break;
        default:
            logSystem(`Comando desconhecido: <em>${base}</em>. Digite /help.`, 'error');
    }
}

function sendMessage(text) {
    if (!text.trim()) return;
    if (text.startsWith('/')) {
        handleCommand(text);
        return;
    }
    if (!state.connected) {
        logSystem('Sem conexão ativa. Use "Criar Sessão", "Entrar na Sessão" ou /demo.', 'warn');
        return;
    }
    if (state.demoMode) {
        logMsg(state.username, text, 'sent');
        return;
    }
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

    logSystem('P2P Chat — WebRTC DataChannel', 'info');
    if (webRTCSupported) {
        logSystem('WebRTC disponível. Use os botões na barra lateral para conectar.', 'success');
        logSystem('Ou digite /demo para testar sem um peer real.', '');
    } else {
        logSystem('WebRTC não disponível neste ambiente.', 'warn');
        logSystem('Use /demo para ver a interface em funcionamento.', '');
    }

    /* Botões de sessão */
    document.getElementById('btnCreateOffer').addEventListener('click', () => {
        if (!webRTCSupported) return logSystem('WebRTC não suportado.', 'error');
        sdpSection.style.display = 'block';
        sdpInput.value = '';
        createOffer();
    });

    document.getElementById('btnJoinSession').addEventListener('click', () => {
        if (!webRTCSupported) return logSystem('WebRTC não suportado.', 'error');
        sdpSection.style.display = 'block';
        sdpOutput.value = '';
        sdpLabel.textContent = '// cole o código de oferta abaixo e clique Confirmar';
        btnConfirm.textContent = 'Gerar Resposta';
        btnConfirm.disabled = false;
        btnConfirm.onclick = joinSession;
    });

    btnCopySDP.addEventListener('click', () => {
        if (!sdpOutput.value) return;
        navigator.clipboard.writeText(sdpOutput.value).then(() => {
            const orig = btnCopySDP.textContent;
            btnCopySDP.textContent = '✓ Copiado!';
            setTimeout(() => { btnCopySDP.textContent = orig; }, 1500);
        });
    });

    /* Input */
    sendBtn.addEventListener('click', () => {
        const val = msgInput.value.trim();
        if (!val) return;
        state.history.unshift(val);
        state.historyIdx = -1;
        sendMessage(val);
        msgInput.value = '';
    });

    msgInput.addEventListener('keydown', (e) => {
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

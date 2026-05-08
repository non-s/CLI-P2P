const SUPABASE_URL      = 'https://bvquyfzllqnbfxncsacn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2cXV5ZnpsbHFuYmZ4bmNzYWNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxODU1MzQsImV4cCI6MjA5Mzc2MTUzNH0.xa_rs4bVLoTv58P7U8rDOaPjo1Dqt60q8cR-IWFpbug';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ID de sessão único — usado como chave de presença para que cada aba seja uma entidade distinta */
const SESSION_ID = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

/* Apelido padrão aleatório para minimizar colisões no primeiro carregamento */
const ADJETIVOS = ['veloz','forte','sombrio','neon','cyber','fantasma','hex','byte','silente','rapido'];
const SUBSTANTIVOS = ['raposa','lobo','falcão','corvo','gato','dev','bit','node','ping','stack'];
function randomNick() {
    return ADJETIVOS[Math.floor(Math.random() * ADJETIVOS.length)] + '_' +
           SUBSTANTIVOS[Math.floor(Math.random() * SUBSTANTIVOS.length)];
}

const state = {
    channel:    null,
    roomCode:   null,
    connected:  false,
    username:   randomNick(),
    history:    [],
    historyIdx: -1,
};

/* ── DOM ──*/
const output         = document.getElementById('output');
const msgInput       = document.getElementById('msgInput');
const sendBtn        = document.getElementById('sendBtn');
const statusDot      = document.getElementById('statusDot');
const statusText     = document.getElementById('statusText');
const inputPrompt    = document.getElementById('inputPrompt');
const roomCodeInput  = document.getElementById('roomCodeInput');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const usersList      = document.getElementById('usersList');
const onlineCount    = document.getElementById('onlineCount');
const connectSection = document.getElementById('connectSection');
const roomSection    = document.getElementById('roomSection');
const onlineSection  = document.getElementById('onlineSection');

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
    const a = author.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const t = text.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    log(`<span class="author">[${a}]</span><span class="text">${t}</span><span class="time">${now()}</span>`, `msg ${type}`);
}

/* ── Status ── */
function setStatus(s) {
    const map = {
        idle:       { dot: '',           text: 'desconectado' },
        connecting: { dot: 'connecting', text: 'conectando...' },
        connected:  { dot: 'connected',  text: 'online' },
    };
    const m = map[s] || map.idle;
    statusDot.className    = `status-dot ${m.dot}`;
    statusText.textContent = m.text;
}

/* ── Helpers ── */
function genCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function esc(s) { return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function updateInfoNick() {
    document.getElementById('infoNick').textContent = state.username;
    inputPrompt.textContent = `${state.username}@chat:~$`;
}

/* ── Presença ── */
function renderUsers(presenceState) {
    const users = Object.values(presenceState).flat().map(p => p.username);
    onlineCount.textContent = users.length;
    usersList.innerHTML = users
        .map(u => `<span class="user-pill${u === state.username ? ' me' : ''}">${esc(u)}${u === state.username ? ' (você)' : ''}</span>`)
        .join('');
}

/* ── Entrar / Sair ── */
async function joinRoom(code) {
    code = code.trim().replace(/\D/g, '');
    if (code.length !== 6) {
        logSystem('Por favor, insira um código de sala de 6 dígitos.', 'warn');
        return;
    }
    if (state.channel) await leaveRoom(true);

    state.roomCode = code;
    setStatus('connecting');
    logSystem(`Entrando na sala ${code}...`, 'info');

    state.channel = sb.channel(`chat-room-${code}`, {
        config: {
            broadcast: { self: true },
            presence:  { key: SESSION_ID },
        },
    });

    /* Mensagens de chat recebidas — self: true garante que recebemos as nossas próprias, mantendo a ordem */
    state.channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
        const isMine = payload.sid === SESSION_ID;
        logMsg(payload.author, payload.text, isMine ? 'sent' : 'received');
    });

    /* Anúncios de entrada/saída de outros usuários */
    state.channel.on('broadcast', { event: 'announce' }, ({ payload }) => {
        if (payload.sid === SESSION_ID) return;
        const verb = payload.type === 'join' ? 'entrou na sala.' : 'saiu da sala.';
        const cls  = payload.type === 'join' ? 'info' : 'warn';
        logSystem(`<strong>${esc(payload.username)}</strong> ${verb}`, cls);
    });

    /* Presença — mantém a lista de usuários online atualizada */
    state.channel.on('presence', { event: 'sync' }, () => {
        renderUsers(state.channel.presenceState());
    });

    state.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            await state.channel.track({ username: state.username, sid: SESSION_ID });
            await state.channel.send({
                type: 'broadcast', event: 'announce',
                payload: { type: 'join', username: state.username, sid: SESSION_ID },
            });

            state.connected = true;
            setStatus('connected');
            roomCodeDisplay.textContent = code;
            document.getElementById('infoRoom').textContent = code;
            connectSection.style.display = 'none';
            roomSection.style.display    = '';
            onlineSection.style.display  = '';

            logSystem(`Conectado à sala <strong>${code}</strong>. Compartilhe o código para convidar outros.`, 'success');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setStatus('idle');
            state.connected = false;
            logSystem('Falha na conexão. Verifique sua rede e tente novamente.', 'error');
        }
    });
}

async function leaveRoom(silent = false) {
    if (!state.channel) return;
    if (state.connected && !silent) {
        try {
            await state.channel.send({
                type: 'broadcast', event: 'announce',
                payload: { type: 'leave', username: state.username, sid: SESSION_ID },
            });
        } catch (_) { /* ignorar erros de envio ao sair */ }
    }
    await sb.removeChannel(state.channel);
    state.channel   = null;
    state.roomCode  = null;
    state.connected = false;
    setStatus('idle');

    usersList.innerHTML = '';
    onlineCount.textContent = '0';
    document.getElementById('infoRoom').textContent = '—';
    connectSection.style.display = '';
    roomSection.style.display    = 'none';
    onlineSection.style.display  = 'none';

    if (!silent) logSystem('Você saiu da sala.', 'warn');
}

/* ── Comandos ── */
const AJUDA = `<span style="color:var(--blue)">Comandos:</span>
  /nick [nome]  — alterar seu apelido
  /leave        — sair da sala atual
  /clear        — limpar o terminal
  /help         — esta ajuda

<span style="color:var(--text-dim)">Para conversar: insira um código de 6 dígitos e entre, ou clique em "Nova Sala".</span>`.trim();

function handleCommand(cmd) {
    const [base, ...args] = cmd.trim().split(/\s+/);
    const arg = args.join(' ');
    switch (base.toLowerCase()) {
        case '/help':
            log(AJUDA, 'system info');
            break;
        case '/nick':
            if (!arg) return logSystem('Uso: /nick [nome]', 'warn');
            if (arg.length > 24) return logSystem('Apelido muito longo (máx. 24 caracteres).', 'warn');
            state.username = arg;
            updateInfoNick();
            if (state.connected) {
                state.channel.track({ username: state.username, sid: SESSION_ID });
            }
            logSystem(`Apelido definido como <strong>${esc(arg)}</strong>`, 'success');
            break;
        case '/leave':
            state.connected ? leaveRoom() : logSystem('Você não está em uma sala.', 'warn');
            break;
        case '/clear':
            output.innerHTML = '';
            break;
        default:
            logSystem(`Comando desconhecido: <em>${esc(base)}</em>. Digite /help.`, 'error');
    }
}

/* ── Enviar ── */
function sendMessage(text) {
    if (!text.trim()) return;
    if (text.startsWith('/')) { handleCommand(text); return; }
    if (!state.connected || !state.channel) {
        logSystem('Você não está em uma sala. Digite um código e clique em "Entrar na Sala".', 'warn');
        return;
    }
    state.channel.send({
        type: 'broadcast',
        event: 'msg',
        payload: { author: state.username, text: text.trim(), sid: SESSION_ID },
    });
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
    updateInfoNick();
    logSystem('Chat em Grupo — Supabase Realtime Broadcast + Presence', 'info');
    logSystem('Digite um código de 6 dígitos para entrar, ou clique em "Nova Sala" para criar uma.', '');
    logSystem('Digite /help para ver os comandos.', '');

    document.getElementById('btnJoin').addEventListener('click', () => joinRoom(roomCodeInput.value));

    document.getElementById('btnNew').addEventListener('click', () => {
        const code = genCode();
        roomCodeInput.value = code;
        joinRoom(code);
    });

    document.getElementById('btnLeave').addEventListener('click', leaveRoom);

    document.getElementById('btnCopyCode').addEventListener('click', () => {
        navigator.clipboard.writeText(state.roomCode || '').then(() => {
            const btn = document.getElementById('btnCopyCode');
            const orig = btn.textContent;
            btn.textContent = '✓ Copiado!';
            setTimeout(() => { btn.textContent = orig; }, 1500);
        });
    });

    roomCodeInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') joinRoom(roomCodeInput.value);
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

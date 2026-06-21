import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
    getDatabase,
    limitToLast,
    off,
    onChildAdded,
    onDisconnect,
    onValue,
    orderByChild,
    push,
    query,
    ref,
    remove,
    serverTimestamp,
    set,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const FIREBASE_CONFIGURED = firebaseConfig?.apiKey && !firebaseConfig.apiKey.includes('REPLACE_');

let firebaseAuth = null;
let realtimeDb = null;
if (FIREBASE_CONFIGURED) {
    const firebaseApp = initializeApp(firebaseConfig);
    firebaseAuth = getAuth(firebaseApp);
    realtimeDb = getDatabase(firebaseApp);
}

/* ID de sessão único — usado como chave de presença para que cada aba seja uma entidade distinta */
const SESSION_ID = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

/* Apelido padrão aleatório para minimizar colisões no primeiro carregamento */
const ADJETIVOS = ['veloz','forte','sombrio','neon','cyber','fantasma','hex','byte','silente','rapido'];
const SUBSTANTIVOS = ['raposa','lobo','falcão','corvo','gato','dev','bit','node','ping','stack'];

/**
 * Handles errors: logs to console and shows user feedback.
 * @param {Error|Object} err
 * @param {string} [context='']
 */
function handleError(err, context = '') {
  const msg = err?.message || String(err) || 'Erro inesperado';
  console.error('[handleError]', context, err);
  setStatus(msg, 'error');
}

/**
 * Returns true only if every provided string is non-empty after trimming.
 * @param {...string} values
 * @returns {boolean}
 */
function validateRequired(...values) {
  return values.every(v => typeof v === 'string' && v.trim().length > 0);
}

/** Generates a random nickname from adjective + noun combination.
 * @returns {string} */
function randomNick() {
    return ADJETIVOS[Math.floor(Math.random() * ADJETIVOS.length)] + '_' +
           SUBSTANTIVOS[Math.floor(Math.random() * SUBSTANTIVOS.length)];
}

const state = {
    roomCode:       null,
    connected:      false,
    username:       randomNick(),
    history:        [],
    historyIdx:     -1,
    roomRef:        null,
    messagesRef:    null,
    presenceRef:    null,
    unsubMessages:  null,
    unsubPresence:  null,
    seenMessages:   new Set(),
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

async function ensureFirebaseReady() {
    if (!FIREBASE_CONFIGURED) throw new Error('Firebase ainda nao configurado.');
    if (firebaseAuth.currentUser) return firebaseAuth.currentUser;

    const authReady = new Promise(resolve => {
        const unsub = onAuthStateChanged(firebaseAuth, user => {
            if (!user) return;
            unsub();
            resolve(user);
        });
    });
    await signInAnonymously(firebaseAuth);
    return authReady;
}

function updateInfoNick() {
    document.getElementById('infoNick').textContent = state.username;
    inputPrompt.textContent = `${state.username}@chat:~$`;
}

/* ── Presença ── */
function renderUsers(presenceState) {
    const users = Object.values(presenceState || {}).map(p => p.username).filter(Boolean);
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
    if (state.connected) await leaveRoom(true);

    state.roomCode = code;
    setStatus('connecting');
    logSystem(`Entrando na sala ${code}...`, 'info');

    try {
        await ensureFirebaseReady();
        state.roomRef = ref(realtimeDb, `clipeer_rooms/${code}`);
        state.messagesRef = ref(realtimeDb, `clipeer_rooms/${code}/messages`);
        state.presenceRef = ref(realtimeDb, `clipeer_rooms/${code}/presence/${SESSION_ID}`);
        state.seenMessages.clear();

        await set(state.presenceRef, {
            username: state.username,
            sid: SESSION_ID,
            updated_at: serverTimestamp(),
        });
        onDisconnect(state.presenceRef).remove();

        state.unsubPresence = onValue(ref(realtimeDb, `clipeer_rooms/${code}/presence`), snapshot => {
            renderUsers(snapshot.val() || {});
        });

        state.unsubMessages = onChildAdded(
            query(state.messagesRef, orderByChild('created_at'), limitToLast(100)),
            snapshot => {
                if (state.seenMessages.has(snapshot.key)) return;
                state.seenMessages.add(snapshot.key);
                const payload = snapshot.val();
                if (!payload) return;
                if (payload.type === 'announce') {
                    if (payload.sid === SESSION_ID) return;
                    const verb = payload.event === 'join' ? 'entrou na sala.' : 'saiu da sala.';
                    const cls  = payload.event === 'join' ? 'info' : 'warn';
                    logSystem(`<strong>${esc(payload.username)}</strong> ${verb}`, cls);
                    return;
                }
                const isMine = payload.sid === SESSION_ID;
                logMsg(payload.author || 'anonimo', payload.text || '', isMine ? 'sent' : 'received');
            }
        );

        await push(state.messagesRef, {
            type: 'announce',
            event: 'join',
            username: state.username,
            sid: SESSION_ID,
            created_at: serverTimestamp(),
        });

        state.connected = true;
        setStatus('connected');
        roomCodeDisplay.textContent = code;
        document.getElementById('infoRoom').textContent = code;
        connectSection.style.display = 'none';
        roomSection.style.display    = '';
        onlineSection.style.display  = '';

        logSystem(`Conectado à sala <strong>${code}</strong>. Compartilhe o código para convidar outros.`, 'success');
    } catch (err) {
        handleError(err, 'joinRoom');
        setStatus('idle');
        state.connected = false;
    }
    return;

}

async function leaveRoom(silent = false) {
    if (!state.connected && !state.presenceRef) return;

    if (state.connected && !silent && state.messagesRef) {
        try {
            await push(state.messagesRef, {
                type: 'announce',
                event: 'leave',
                username: state.username,
                sid: SESSION_ID,
                created_at: serverTimestamp(),
            });
        } catch (_) { /* ignorar erros de envio ao sair */ }
    }

    if (state.unsubMessages) state.unsubMessages();
    if (state.unsubPresence) state.unsubPresence();
    if (state.messagesRef) off(state.messagesRef);
    if (state.presenceRef) {
        try { await remove(state.presenceRef); } catch (_) { /* ignorar cleanup */ }
    }

    state.roomRef       = null;
    state.messagesRef   = null;
    state.presenceRef   = null;
    state.unsubMessages = null;
    state.unsubPresence = null;
    state.roomCode      = null;
    state.connected     = false;
    state.seenMessages.clear();
    setStatus('idle');

    usersList.innerHTML = '';
    onlineCount.textContent = '0';
    document.getElementById('infoRoom').textContent = '—';
    connectSection.style.display = '';
    roomSection.style.display    = 'none';
    onlineSection.style.display  = 'none';

    if (!silent) logSystem('Você saiu da sala.', 'warn');
    return;

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
            if (state.connected && state.presenceRef) {
                set(state.presenceRef, {
                    username: state.username,
                    sid: SESSION_ID,
                    updated_at: serverTimestamp(),
                });
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
    if (!state.connected || !state.messagesRef) {
        logSystem('Você não está em uma sala. Digite um código e clique em "Entrar na Sala".', 'warn');
        return;
    }
    push(state.messagesRef, {
        type: 'msg',
        author: state.username,
        text: text.trim(),
        sid: SESSION_ID,
        created_at: serverTimestamp(),
    }).catch(err => handleError(err, 'sendMessage'));
    return;
}


/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
    updateInfoNick();
    logSystem('Chat em Grupo — Firebase Realtime Database', 'info');
    logSystem('Digite um código de 6 dígitos para entrar, ou clique em "Nova Sala" para criar uma.', '');
    logSystem('Digite /help para ver os comandos.', '');

    /* Preencher apelido a partir do campo de nickname na entrada */
    const nickField = document.getElementById('nickInput');
    if (nickField) {
        nickField.value = state.username;
        nickField.addEventListener('change', () => {
            const v = nickField.value.trim();
            if (v && v.length <= 24) {
                state.username = v;
                updateInfoNick();
            }
        });
    }

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

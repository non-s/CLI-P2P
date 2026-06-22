import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
    endAt,
    get,
    getDatabase,
    limitToFirst,
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
const CLI_P2P_LIMITS = Object.freeze({
    history: 100,
    localHistory: 100,
    messageText: 500,
    nickname: 24,
    presence: 200,
    presencePrune: 50,
    presenceTtlMs: 2 * 60 * 1000,
    messageRetentionMs: 24 * 60 * 60 * 1000,
    pruneIntervalMs: 5 * 60 * 1000,
    sendCooldownMs: 800,
    sidBytes: 16,
});

window.CLI_P2P_LIMITS = CLI_P2P_LIMITS;

let firebaseAuth = null;
let realtimeDb = null;
if (FIREBASE_CONFIGURED) {
    const firebaseApp = initializeApp(firebaseConfig);
    firebaseAuth = getAuth(firebaseApp);
    realtimeDb = getDatabase(firebaseApp);
}

const ADJECTIVES = ['veloz', 'forte', 'neon', 'cyber', 'hex', 'byte', 'silente', 'rapido'];
const NOUNS = ['dev', 'bit', 'node', 'ping', 'stack', 'kernel', 'shell', 'pixel'];

function secureRandomInt(max) {
    if (!globalThis.crypto?.getRandomValues) {
        throw new Error('Web Crypto indisponivel neste navegador.');
    }
    const bucket = new Uint32Array(1);
    const limit = Math.floor(0xffffffff / max) * max;
    do {
        globalThis.crypto.getRandomValues(bucket);
    } while (bucket[0] >= limit);
    return bucket[0] % max;
}

function randomHex(bytes) {
    if (!globalThis.crypto?.getRandomValues) {
        throw new Error('Web Crypto indisponivel neste navegador.');
    }
    const data = new Uint8Array(bytes);
    globalThis.crypto.getRandomValues(data);
    return Array.from(data, b => b.toString(16).padStart(2, '0')).join('');
}

function randomNick() {
    return `${ADJECTIVES[secureRandomInt(ADJECTIVES.length)]}_${NOUNS[secureRandomInt(NOUNS.length)]}`;
}

const SESSION_ID = randomHex(CLI_P2P_LIMITS.sidBytes);

const state = {
    roomCode: null,
    connected: false,
    username: randomNick(),
    uid: null,
    presenceId: null,
    history: [],
    historyIdx: -1,
    roomRef: null,
    messagesRef: null,
    presenceListRef: null,
    presenceRef: null,
    unsubMessages: null,
    unsubPresence: null,
    heartbeatTimer: null,
    seenMessages: new Set(),
    lastMessagePruneAt: 0,
    lastPresencePruneAt: 0,
    lastSentAt: 0,
};

const output = document.getElementById('output');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const inputPrompt = document.getElementById('inputPrompt');
const roomCodeInput = document.getElementById('roomCodeInput');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const usersList = document.getElementById('usersList');
const onlineCount = document.getElementById('onlineCount');
const connectSection = document.getElementById('connectSection');
const roomSection = document.getElementById('roomSection');
const onlineSection = document.getElementById('onlineSection');

function now() {
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function span(className, text) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    return element;
}

function appendLog(className, nodes) {
    const div = document.createElement('div');
    div.className = `msg ${className}`;
    for (const node of nodes) div.appendChild(node);
    div.appendChild(span('time', now()));
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
}

function logSystem(text, variant = '') {
    appendLog(`system ${variant}`.trim(), [span('text', text)]);
}

function logMsg(author, text, type = 'received') {
    appendLog(type, [
        span('author', `[${author}]`),
        span('text', text),
    ]);
}

function logHelp() {
    logSystem([
        'Comandos:',
        '  /nick [nome]  - alterar seu apelido',
        '  /leave        - sair da sala atual',
        '  /clear        - limpar o terminal',
        '  /help         - esta ajuda',
        '',
        'Para conversar: insira um codigo de 6 digitos e entre, ou clique em "Nova Sala".',
    ].join('\n'), 'info');
}

function setStatus(status) {
    const map = {
        idle: { dot: '', text: 'desconectado' },
        connecting: { dot: 'connecting', text: 'conectando...' },
        connected: { dot: 'connected', text: 'online' },
    };
    const next = map[status] || map.idle;
    statusDot.className = `status-dot ${next.dot}`;
    statusText.textContent = next.text;
}

function stripControls(value) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeUsername(value) {
    const nick = stripControls(value).slice(0, CLI_P2P_LIMITS.nickname);
    return nick || randomNick();
}

function normalizeMessage(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, CLI_P2P_LIMITS.messageText);
}

function normalizeRoomCode(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function genCode() {
    return String(secureRandomInt(900000) + 100000);
}

function presenceKey(uid) {
    return `${uid}_${SESSION_ID}`.replace(/[.#$/[\]]/g, '_').slice(0, 160);
}

function updateInfoNick() {
    document.getElementById('infoNick').textContent = state.username;
    inputPrompt.textContent = `${state.username}@chat:~$`;
}

function handleError(err, context = '') {
    const msg = err?.message || String(err) || 'Erro inesperado';
    console.error('[handleError]', context, err);
    logSystem(msg, 'error');
}

async function ensureFirebaseReady() {
    if (!FIREBASE_CONFIGURED) throw new Error('Firebase ainda nao configurado.');
    if (firebaseAuth.currentUser) return firebaseAuth.currentUser;

    const authReady = new Promise(resolve => {
        const unsubscribe = onAuthStateChanged(firebaseAuth, user => {
            if (!user) return;
            unsubscribe();
            resolve(user);
        });
    });
    await signInAnonymously(firebaseAuth);
    return authReady;
}

function validIncomingMessage(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (typeof payload.sid !== 'string' || typeof payload.uid !== 'string') return false;
    if (payload.type === 'announce') {
        return ['join', 'leave'].includes(payload.event)
            && typeof payload.username === 'string'
            && payload.username.length <= CLI_P2P_LIMITS.nickname;
    }
    if (payload.type === 'msg') {
        return typeof payload.author === 'string'
            && payload.author.length <= CLI_P2P_LIMITS.nickname
            && typeof payload.text === 'string'
            && payload.text.length <= CLI_P2P_LIMITS.messageText;
    }
    return false;
}

function renderUsers(presenceState) {
    const staleBefore = Date.now() - CLI_P2P_LIMITS.presenceTtlMs;
    const users = Object.values(presenceState || {})
        .filter(user => user && typeof user.username === 'string' && Number(user.updated_at || 0) >= staleBefore)
        .sort((a, b) => String(a.username).localeCompare(String(b.username), 'pt-BR'))
        .slice(0, CLI_P2P_LIMITS.presence);

    onlineCount.textContent = String(users.length);
    usersList.replaceChildren(...users.map(user => {
        const pill = document.createElement('span');
        const isMe = user.uid === state.uid && user.sid === state.presenceId;
        pill.className = `user-pill${isMe ? ' me' : ''}`;
        pill.textContent = `${user.username}${isMe ? ' (voce)' : ''}`;
        return pill;
    }));
}

async function writePresence() {
    if (!state.presenceRef || !state.uid || !state.presenceId) return;
    await set(state.presenceRef, {
        uid: state.uid,
        username: state.username,
        sid: state.presenceId,
        updated_at: serverTimestamp(),
    });
}

async function pruneRoomMessages(force = false) {
    if (!state.messagesRef) return;
    const nowMs = Date.now();
    if (!force && nowMs - state.lastMessagePruneAt < CLI_P2P_LIMITS.pruneIntervalMs) return;
    state.lastMessagePruneAt = nowMs;

    try {
        const staleMessages = await get(query(
            state.messagesRef,
            orderByChild('created_at'),
            endAt(nowMs - CLI_P2P_LIMITS.messageRetentionMs),
            limitToFirst(CLI_P2P_LIMITS.presencePrune),
        ));
        const removals = [];
        staleMessages.forEach(child => removals.push(remove(child.ref)));
        await Promise.all(removals);
    } catch (err) {
        console.warn('[pruneRoomMessages]', err?.message || err);
    }
}

async function pruneRoomPresence(force = false) {
    if (!state.presenceListRef) return;
    const nowMs = Date.now();
    if (!force && nowMs - state.lastPresencePruneAt < CLI_P2P_LIMITS.pruneIntervalMs) return;
    state.lastPresencePruneAt = nowMs;

    try {
        const stalePresence = await get(query(
            state.presenceListRef,
            orderByChild('updated_at'),
            endAt(nowMs - CLI_P2P_LIMITS.presenceTtlMs),
            limitToFirst(CLI_P2P_LIMITS.presencePrune),
        ));
        const removals = [];
        stalePresence.forEach(child => {
            if (child.key !== state.presenceId) removals.push(remove(child.ref));
        });
        await Promise.all(removals);
    } catch (err) {
        console.warn('[pruneRoomPresence]', err?.message || err);
    }
}

async function joinRoom(rawCode) {
    const code = normalizeRoomCode(rawCode);
    if (code.length !== 6) {
        logSystem('Por favor, insira um codigo de sala de 6 digitos.', 'warn');
        return;
    }
    if (state.connected) await leaveRoom(true);

    state.roomCode = code;
    setStatus('connecting');
    logSystem(`Entrando na sala ${code}...`, 'info');

    try {
        const user = await ensureFirebaseReady();
        state.uid = user.uid;
        state.presenceId = presenceKey(user.uid);
        state.roomRef = ref(realtimeDb, `clipeer_rooms/${code}`);
        state.messagesRef = ref(realtimeDb, `clipeer_rooms/${code}/messages`);
        state.presenceListRef = ref(realtimeDb, `clipeer_rooms/${code}/presence`);
        state.presenceRef = ref(realtimeDb, `clipeer_rooms/${code}/presence/${state.presenceId}`);
        state.seenMessages.clear();

        await writePresence();
        onDisconnect(state.presenceRef).remove();

        state.unsubPresence = onValue(
            query(state.presenceListRef, orderByChild('updated_at'), limitToLast(CLI_P2P_LIMITS.presence)),
            snapshot => renderUsers(snapshot.val() || {}),
        );

        state.unsubMessages = onChildAdded(
            query(state.messagesRef, orderByChild('created_at'), limitToLast(CLI_P2P_LIMITS.history)),
            snapshot => {
                if (state.seenMessages.has(snapshot.key)) return;
                state.seenMessages.add(snapshot.key);
                const payload = snapshot.val();
                if (!validIncomingMessage(payload)) return;
                if (payload.type === 'announce') {
                    if (payload.sid === state.presenceId) return;
                    const verb = payload.event === 'join' ? 'entrou na sala.' : 'saiu da sala.';
                    const cls = payload.event === 'join' ? 'info' : 'warn';
                    logSystem(`${payload.username} ${verb}`, cls);
                    return;
                }
                const isMine = payload.sid === state.presenceId;
                logMsg(payload.author || 'anonimo', payload.text || '', isMine ? 'sent' : 'received');
            },
        );

        await push(state.messagesRef, {
            type: 'announce',
            event: 'join',
            uid: state.uid,
            username: state.username,
            sid: state.presenceId,
            created_at: serverTimestamp(),
        });

        state.heartbeatTimer = window.setInterval(() => {
            writePresence().catch(err => console.warn('[presence heartbeat]', err?.message || err));
            pruneRoomPresence().catch(() => {});
        }, Math.max(30_000, Math.floor(CLI_P2P_LIMITS.presenceTtlMs / 2)));

        await Promise.all([pruneRoomMessages(true), pruneRoomPresence(true)]);

        state.connected = true;
        setStatus('connected');
        roomCodeDisplay.textContent = code;
        document.getElementById('infoRoom').textContent = code;
        connectSection.style.display = 'none';
        roomSection.style.display = '';
        onlineSection.style.display = '';

        logSystem(`Conectado a sala ${code}. Compartilhe o codigo para convidar outros.`, 'success');
    } catch (err) {
        handleError(err, 'joinRoom');
        setStatus('idle');
        state.connected = false;
    }
}

async function leaveRoom(silent = false) {
    if (!state.connected && !state.presenceRef) return;

    if (state.heartbeatTimer) window.clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;

    if (state.connected && !silent && state.messagesRef && state.uid && state.presenceId) {
        try {
            await push(state.messagesRef, {
                type: 'announce',
                event: 'leave',
                uid: state.uid,
                username: state.username,
                sid: state.presenceId,
                created_at: serverTimestamp(),
            });
        } catch (_) {
            // Best effort only: leaving the room should continue even if the announce fails.
        }
    }

    if (state.unsubMessages) state.unsubMessages();
    if (state.unsubPresence) state.unsubPresence();
    if (state.messagesRef) off(state.messagesRef);
    if (state.presenceListRef) off(state.presenceListRef);
    if (state.presenceRef) {
        try { await remove(state.presenceRef); } catch (_) { /* best-effort cleanup */ }
    }

    state.roomRef = null;
    state.messagesRef = null;
    state.presenceListRef = null;
    state.presenceRef = null;
    state.unsubMessages = null;
    state.unsubPresence = null;
    state.roomCode = null;
    state.connected = false;
    state.presenceId = null;
    state.seenMessages.clear();
    setStatus('idle');

    usersList.replaceChildren();
    onlineCount.textContent = '0';
    document.getElementById('infoRoom').textContent = '-';
    connectSection.style.display = '';
    roomSection.style.display = 'none';
    onlineSection.style.display = 'none';

    if (!silent) logSystem('Voce saiu da sala.', 'warn');
}

function handleCommand(cmd) {
    const [base, ...args] = cmd.trim().split(/\s+/);
    const arg = args.join(' ');
    switch (base.toLowerCase()) {
        case '/help':
            logHelp();
            break;
        case '/nick': {
            if (!arg) {
                logSystem('Uso: /nick [nome]', 'warn');
                return;
            }
            const nick = normalizeUsername(arg);
            state.username = nick;
            updateInfoNick();
            if (state.connected && state.presenceRef) {
                writePresence().catch(err => handleError(err, 'nick'));
            }
            logSystem(`Apelido definido como ${nick}`, 'success');
            break;
        }
        case '/leave':
            if (state.connected) leaveRoom();
            else logSystem('Voce nao esta em uma sala.', 'warn');
            break;
        case '/clear':
            output.replaceChildren();
            break;
        default:
            logSystem(`Comando desconhecido: ${base}. Digite /help.`, 'error');
    }
}

function rememberHistory(value) {
    state.history.unshift(value);
    state.history = state.history.slice(0, CLI_P2P_LIMITS.localHistory);
    state.historyIdx = -1;
}

function sendMessage(rawText) {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) return;
    if (trimmed.startsWith('/')) {
        handleCommand(trimmed);
        return;
    }
    if (!state.connected || !state.messagesRef || !state.uid || !state.presenceId) {
        logSystem('Voce nao esta em uma sala. Digite um codigo e clique em "Entrar na Sala".', 'warn');
        return;
    }

    const nowMs = Date.now();
    if (nowMs - state.lastSentAt < CLI_P2P_LIMITS.sendCooldownMs) {
        logSystem('Aguarde um instante antes de enviar outra mensagem.', 'warn');
        return;
    }

    const text = normalizeMessage(trimmed);
    if (!text) return;
    state.lastSentAt = nowMs;

    push(state.messagesRef, {
        type: 'msg',
        uid: state.uid,
        author: state.username,
        text,
        sid: state.presenceId,
        created_at: serverTimestamp(),
    }).catch(err => handleError(err, 'sendMessage'));

    pruneRoomMessages().catch(() => {});
    pruneRoomPresence().catch(() => {});
}

function submitInput() {
    const value = msgInput.value;
    const normalized = normalizeMessage(value);
    if (!normalized && !String(value || '').trim().startsWith('/')) return;
    rememberHistory(value.trim());
    sendMessage(value);
    msgInput.value = '';
}

document.addEventListener('DOMContentLoaded', () => {
    msgInput.maxLength = CLI_P2P_LIMITS.messageText;
    roomCodeInput.maxLength = 6;
    updateInfoNick();
    logSystem('Chat em Grupo - Firebase Realtime Database', 'info');
    logSystem('Digite um codigo de 6 digitos para entrar, ou clique em "Nova Sala" para criar uma.');
    logSystem('Digite /help para ver os comandos.');

    const nickField = document.getElementById('nickInput');
    if (nickField) {
        nickField.maxLength = CLI_P2P_LIMITS.nickname;
        nickField.value = state.username;
        nickField.addEventListener('change', () => {
            state.username = normalizeUsername(nickField.value);
            nickField.value = state.username;
            updateInfoNick();
            if (state.connected) writePresence().catch(err => handleError(err, 'nick'));
        });
    }

    document.getElementById('btnJoin').addEventListener('click', () => joinRoom(roomCodeInput.value));

    document.getElementById('btnNew').addEventListener('click', () => {
        const code = genCode();
        roomCodeInput.value = code;
        joinRoom(code);
    });

    document.getElementById('btnLeave').addEventListener('click', () => leaveRoom());

    document.getElementById('btnCopyCode').addEventListener('click', () => {
        const btn = document.getElementById('btnCopyCode');
        const original = btn.textContent;
        const code = state.roomCode || '';
        if (!navigator.clipboard || !code) return;
        navigator.clipboard.writeText(code).then(() => {
            btn.textContent = 'Copiado!';
            setTimeout(() => { btn.textContent = original; }, 1500);
        });
    });

    roomCodeInput.addEventListener('input', () => {
        roomCodeInput.value = normalizeRoomCode(roomCodeInput.value);
    });
    roomCodeInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') joinRoom(roomCodeInput.value);
    });

    sendBtn.addEventListener('click', submitInput);

    msgInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            submitInput();
            return;
        }
        if (event.key === 'ArrowUp') {
            state.historyIdx = Math.min(state.historyIdx + 1, state.history.length - 1);
            msgInput.value = state.history[state.historyIdx] || '';
            event.preventDefault();
        }
        if (event.key === 'ArrowDown') {
            state.historyIdx = Math.max(state.historyIdx - 1, -1);
            msgInput.value = state.historyIdx < 0 ? '' : state.history[state.historyIdx];
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && state.connected) {
            writePresence().catch(() => {});
        }
    });

    window.addEventListener('pagehide', () => {
        if (state.presenceRef) remove(state.presenceRef).catch(() => {});
    });
});

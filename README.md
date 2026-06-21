# Chat em Grupo — Firebase Realtime Database

Chat em grupo no navegador usando Firebase Realtime Database. Compartilhe um código de sala — todos se conectam instantaneamente.

**[→ Abrir demo](https://non-s.github.io/CLI-P2P/)**

## Como funciona

1. **Clique em "Nova Sala"** — o cliente gera um código de 6 dígitos e entra no nó Firebase correspondente.
2. **Compartilhe o código** com qualquer pessoa — ela digita o código e clica em "Entrar na Sala".
3. Todas as mensagens são gravadas e sincronizadas pelo Realtime Database.
4. Ao sair da sala, `onDisconnect` remove o usuário da lista de presença.

## Comandos

```
/nick [nome]  — alterar seu apelido
/leave        — sair da sala atual
/clear        — limpar o terminal
/help         — lista de comandos
```

## Stack

HTML · CSS · JavaScript — sem frameworks, sem etapa de build.

| Camada      | Tecnologia                        |
|-------------|-----------------------------------|
| Mensagens   | Firebase Realtime Database        |
| Presença    | Firebase Realtime Database        |
| Identidade  | Firebase Anonymous Auth + sessão  |

## Firebase setup

1. Create a Firebase project.
2. Enable Authentication > Anonymous provider.
3. Enable Realtime Database.
4. Copy the Web app config into `firebase-config.js`.
5. Publish `database.rules.json`.

## Arquivos

```
CLI-P2P/
├── index.html   — layout, sidebar, terminal
├── style.css    — tema terminal escuro, responsivo
├── script.js    — lógica Firebase, mensagens e presença
└── README.md
```

---

[Portfolio](https://non-s.github.io/Portfolio) · [TakStud](https://non-s.github.io/TakStud)

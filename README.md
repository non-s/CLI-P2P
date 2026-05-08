# Chat em Grupo — Supabase Realtime

Chat em grupo no navegador usando Supabase Realtime Broadcast + Presence. Compartilhe um código de sala — todos se conectam instantaneamente.

**[→ Abrir demo](https://non-s.github.io/Profile-)**

## Como funciona

1. **Clique em "Nova Sala"** — o cliente gera um código de 6 dígitos e entra no canal Supabase Realtime correspondente.
2. **Compartilhe o código** com qualquer pessoa — ela digita o código e clica em "Entrar na Sala".
3. Todas as mensagens são transmitidas via Broadcast. O Presence mantém a lista de usuários online atualizada em tempo real.
4. Ao sair da sala o canal é encerrado e o usuário é removido da lista de presença.

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
| Mensagens   | Supabase Realtime (Broadcast)     |
| Presença    | Supabase Realtime (Presence)      |
| Identidade  | Apelido aleatório + UUID de sessão|

## Arquivos

```
Profile-/
├── index.html   — layout, sidebar, terminal
├── style.css    — tema terminal escuro, responsivo
├── script.js    — lógica de canal, broadcast, presence
└── README.md
```

---

[Portfolio](https://non-s.github.io/Portfolio) · [TakStud](https://non-s.github.io/TakStud)

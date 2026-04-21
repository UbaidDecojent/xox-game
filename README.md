# XOX Pulse

A dependency-free browser XOX game with a server-authoritative multiplayer mode.

## Run locally

```bash
npm start
```

Open `http://localhost:3000`, switch to Online mode, then create or join a room code.

## Files

- `index.html` - game markup
- `styles.css` - responsive visual system
- `main.js` - client game UI, effects, AI, and multiplayer socket client
- `server.js` - static file server plus WebSocket multiplayer rooms

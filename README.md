# XOX Pulse

A dependency-free browser XOX game with a server-authoritative multiplayer mode.

## Run locally

```bash
npm start
```

Open `http://localhost:3000`, switch to Online mode, then create or join a room code.

## Deploying

Static hosts like Netlify can serve the game UI, but they do not run the long-lived
WebSocket server in `server.js`. For Online mode in production:

1. Deploy `server.js` to a Node host that supports WebSockets.
2. Set `websocketUrl` in `config.js` to that backend URL, for example:

```js
window.XOX_CONFIG = {
  websocketUrl: "wss://your-xox-server.example.com/ws",
};
```

If `websocketUrl` is empty on a non-localhost domain, Online mode is disabled
instead of repeatedly trying to connect to `wss://your-site/ws`.

## Files

- `index.html` - game markup
- `config.js` - optional production WebSocket endpoint
- `styles.css` - responsive visual system
- `main.js` - client game UI, effects, AI, and multiplayer socket client
- `server.js` - static file server plus WebSocket multiplayer rooms

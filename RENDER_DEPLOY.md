# Render WebSocket Backend

Netlify should keep hosting the frontend. Render should run the Node WebSocket
backend from `server.js`.

## Deploy on Render

1. Push these backend-prep files to GitHub:
   - `server.js`
   - `package.json`
   - `render.yaml`
   - `RENDER_DEPLOY.md`
2. In Render, create a new **Web Service** from the GitHub repository.
3. Use these settings if Render does not auto-detect `render.yaml`:
   - Runtime: `Node`
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/healthz`
4. After deploy, copy the Render service URL. It will look like:

```text
https://xox-game-server.onrender.com
```

## Connect Netlify to Render

Update Netlify's frontend `config.js`:

```js
window.XOX_CONFIG = {
  websocketUrl: "wss://xox-game-server.onrender.com/ws",
};
```

Use your actual Render hostname. The important parts are:

- `https://` becomes `wss://`
- Keep the `/ws` path
- Do not use the Netlify frontend URL here

## Quick Test

Open this in a browser after Render deploys:

```text
https://xox-game-server.onrender.com/healthz
```

It should return:

```json
{"ok":true}
```

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const winCombos = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const rooms = new Map();
const clients = new Map();

const server = http.createServer((request, response) => {
  if (request.url && new URL(request.url, "http://localhost").pathname === "/healthz") {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  const safePath = getSafeFilePath(request.url);

  if (!safePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(safePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(safePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
});

server.on("upgrade", (request, socket) => {
  if (!request.url || new URL(request.url, "http://localhost").pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  attachClient(socket);
});

server.listen(PORT, HOST, () => {
  console.log(`XOX Pulse multiplayer server running on ${HOST}:${PORT}`);
});

function getSafeFilePath(url) {
  const parsed = new URL(url || "/", "http://localhost");
  const pathname = decodeURIComponent(parsed.pathname === "/" ? "/index.html" : parsed.pathname);
  const normalized = path.normalize(path.join(ROOT, pathname));
  const relative = path.relative(ROOT, normalized);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return normalized;
}

function attachClient(socket) {
  const client = {
    id: makeId(12),
    socket,
    buffer: Buffer.alloc(0),
    roomId: null,
    player: null,
  };

  clients.set(client.id, client);
  send(client, { type: "hello", id: client.id });

  socket.on("data", (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    readFrames(client);
  });

  socket.on("close", () => disconnectClient(client));
  socket.on("error", () => disconnectClient(client));
}

function readFrames(client) {
  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) === 0x80;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (client.buffer.length < offset + 2) {
        return;
      }
      length = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (client.buffer.length < offset + 8) {
        return;
      }
      const high = client.buffer.readUInt32BE(offset);
      const low = client.buffer.readUInt32BE(offset + 4);
      length = high * 2 ** 32 + low;
      offset += 8;
    }

    if (!masked || length > 64 * 1024) {
      client.socket.destroy();
      return;
    }

    if (client.buffer.length < offset + 4 + length) {
      return;
    }

    const mask = client.buffer.subarray(offset, offset + 4);
    offset += 4;
    const encoded = client.buffer.subarray(offset, offset + length);
    const payload = Buffer.alloc(length);

    for (let i = 0; i < length; i += 1) {
      payload[i] = encoded[i] ^ mask[i % 4];
    }

    client.buffer = client.buffer.subarray(offset + length);

    if (opcode === 0x8) {
      client.socket.end();
      return;
    }

    if (opcode === 0x9) {
      sendFrame(client.socket, payload, 0x0a);
      continue;
    }

    if (opcode === 0x1) {
      handleMessage(client, payload.toString("utf8"));
    }
  }
}

function handleMessage(client, raw) {
  let message;

  try {
    message = JSON.parse(raw);
  } catch {
    sendError(client, "Invalid message.");
    return;
  }

  if (message.type === "createRoom") {
    createRoom(client);
  } else if (message.type === "joinRoom") {
    joinRoom(client, message.roomId);
  } else if (message.type === "leaveRoom") {
    leaveRoom(client);
  } else if (message.type === "move") {
    playMove(client, message.index);
  } else if (message.type === "resetRound") {
    resetRoomRound(client);
  } else if (message.type === "setPulse") {
    setRoomPulse(client, Boolean(message.pulse));
  } else {
    sendError(client, "Unknown command.");
  }
}

function createRoom(client) {
  leaveRoom(client);

  let roomId = makeRoomId();
  while (rooms.has(roomId)) {
    roomId = makeRoomId();
  }

  const room = {
    id: roomId,
    clients: new Set(),
    players: { X: null, O: null },
    hostId: client.id,
    board: Array(9).fill(null),
    turn: "X",
    pulse: true,
    gameOver: false,
    round: 1,
    scores: { X: 0, O: 0, draw: 0 },
    orders: { X: [], O: [] },
    winCombo: null,
    revision: 0,
  };

  rooms.set(roomId, room);
  room.clients.add(client.id);
  room.players.X = client.id;
  client.roomId = roomId;
  client.player = "X";
  broadcastState(room, [{ type: "notice", message: "Room created." }]);
}

function joinRoom(client, requestedRoomId) {
  const roomId = String(requestedRoomId || "").trim().toUpperCase();
  const room = rooms.get(roomId);

  if (!room) {
    sendError(client, "Room not found.");
    return;
  }

  leaveRoom(client);
  room.clients.add(client.id);
  client.roomId = room.id;

  if (!room.players.X) {
    room.players.X = client.id;
    client.player = "X";
  } else if (!room.players.O) {
    room.players.O = client.id;
    client.player = "O";
  } else {
    client.player = null;
  }

  if (!room.hostId) {
    room.hostId = client.id;
  }

  broadcastState(room, [{ type: "notice", message: `${client.player || "Spectator"} joined.` }]);
}

function leaveRoom(client) {
  if (!client.roomId) {
    return;
  }

  const room = rooms.get(client.roomId);
  if (!room) {
    client.roomId = null;
    client.player = null;
    return;
  }

  const wasPlayer = room.players.X === client.id || room.players.O === client.id;
  room.clients.delete(client.id);

  if (room.players.X === client.id) {
    room.players.X = null;
  }

  if (room.players.O === client.id) {
    room.players.O = null;
  }

  if (room.hostId === client.id) {
    room.hostId = room.clients.values().next().value || null;
  }

  client.roomId = null;
  client.player = null;
  send(client, { type: "leftRoom" });

  if (!room.clients.size) {
    rooms.delete(room.id);
    return;
  }

  if (wasPlayer) {
    resetRoom(room, true);
  }

  broadcastState(room, [{ type: "notice", message: "Player left." }]);
}

function disconnectClient(client) {
  leaveRoom(client);
  clients.delete(client.id);
}

function playMove(client, index) {
  const room = getClientRoom(client);
  const slot = Number(index);

  if (!room || !client.player) {
    sendError(client, "Join as a player first.");
    return;
  }

  if (!Number.isInteger(slot) || slot < 0 || slot > 8) {
    sendError(client, "Invalid square.");
    return;
  }

  if (room.gameOver) {
    sendError(client, "Round is over.");
    return;
  }

  if (!room.players.X || !room.players.O) {
    sendError(client, "Waiting for an opponent.");
    return;
  }

  if (room.turn !== client.player) {
    sendError(client, "Wait for your turn.");
    return;
  }

  if (room.board[slot]) {
    sendError(client, "Square is occupied.");
    return;
  }

  const player = client.player;
  const events = [{ type: "place", index: slot, player }];
  room.board[slot] = player;
  room.orders[player].push(slot);

  if (room.pulse && room.orders[player].length > 3) {
    const removedIndex = room.orders[player].shift();
    if (removedIndex !== slot) {
      room.board[removedIndex] = null;
      events.push({ type: "remove", index: removedIndex, player });
    }
  }

  const result = evaluateBoard(room.board);
  if (result.winner) {
    room.gameOver = true;
    room.turn = result.winner;
    room.winCombo = result.combo;
    room.scores[result.winner] += 1;
    events.push({ type: "win", player: result.winner, combo: result.combo });
  } else if (!room.pulse && result.draw) {
    room.gameOver = true;
    room.scores.draw += 1;
    events.push({ type: "draw" });
  } else {
    room.turn = player === "X" ? "O" : "X";
  }

  room.revision += 1;
  broadcastState(room, events);
}

function resetRoomRound(client) {
  const room = getClientRoom(client);
  if (!room) {
    sendError(client, "Join a room first.");
    return;
  }

  if (room.hostId !== client.id) {
    sendError(client, "Only the host can reset.");
    return;
  }

  resetRoom(room, true);
  broadcastState(room, [{ type: "reset" }]);
}

function setRoomPulse(client, pulse) {
  const room = getClientRoom(client);
  if (!room) {
    sendError(client, "Join a room first.");
    return;
  }

  if (room.hostId !== client.id) {
    sendError(client, "Only the host can change rules.");
    return;
  }

  room.pulse = pulse;
  resetRoom(room, true);
  broadcastState(room, [{ type: "reset" }, { type: "notice", message: `Pulse ${pulse ? "on" : "off"}.` }]);
}

function resetRoom(room, incrementRound) {
  room.board = Array(9).fill(null);
  room.turn = "X";
  room.gameOver = false;
  room.orders = { X: [], O: [] };
  room.winCombo = null;
  room.revision += 1;

  if (incrementRound) {
    room.round += 1;
  }
}

function getClientRoom(client) {
  return client.roomId ? rooms.get(client.roomId) : null;
}

function evaluateBoard(board) {
  for (const combo of winCombos) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], combo, draw: false };
    }
  }

  return { winner: null, combo: null, draw: board.every(Boolean) };
}

function broadcastState(room, events) {
  for (const clientId of room.clients) {
    const client = clients.get(clientId);
    if (!client) {
      continue;
    }

    send(client, {
      type: "state",
      roomId: room.id,
      player: client.player,
      host: room.hostId === client.id,
      players: {
        X: Boolean(room.players.X),
        O: Boolean(room.players.O),
      },
      spectators: Math.max(0, room.clients.size - Number(Boolean(room.players.X)) - Number(Boolean(room.players.O))),
      board: room.board,
      turn: room.turn,
      pulse: room.pulse,
      gameOver: room.gameOver,
      round: room.round,
      scores: room.scores,
      orders: room.orders,
      winCombo: room.winCombo,
      revision: room.revision,
      events,
    });
  }
}

function sendError(client, message) {
  send(client, { type: "error", message });
}

function send(client, payload) {
  if (client.socket.destroyed) {
    return;
  }

  sendFrame(client.socket, Buffer.from(JSON.stringify(payload)), 0x1);
}

function sendFrame(socket, payload, opcode) {
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }

  header[0] = 0x80 | opcode;
  socket.write(Buffer.concat([header, payload]));
}

function makeRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 5; i += 1) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }

  return code;
}

function makeId(size) {
  return crypto.randomBytes(size).toString("hex");
}

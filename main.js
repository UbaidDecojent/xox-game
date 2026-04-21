(function () {
  "use strict";

  const X_COLOR = "#ff3f54";
  const O_COLOR = "#5cd8ff";
  const INK_COLOR = "#f5f1e8";

  const cells = Array.from(document.querySelectorAll(".cell"));
  const boardEl = document.getElementById("board");
  const statusText = document.getElementById("status-text");
  const roundLabel = document.getElementById("round-label");
  const pulseToggle = document.getElementById("pulse-toggle");
  const modeButtons = Array.from(document.querySelectorAll(".mode-btn"));
  const difficultyBtn = document.getElementById("difficulty-btn");
  const difficultyLabel = document.getElementById("difficulty-label");
  const soundBtn = document.getElementById("sound-btn");
  const resetBtn = document.getElementById("reset-btn");
  const onlinePanel = document.getElementById("online-panel");
  const onlineStatus = document.getElementById("online-status");
  const roomCode = document.getElementById("room-code");
  const roomInput = document.getElementById("room-input");
  const createRoomBtn = document.getElementById("create-room-btn");
  const joinRoomBtn = document.getElementById("join-room-btn");
  const leaveRoomBtn = document.getElementById("leave-room-btn");
  const scoreX = document.getElementById("score-x");
  const scoreO = document.getElementById("score-o");
  const scoreDraw = document.getElementById("score-draw");
  const winLine = document.getElementById("win-line");
  const winPath = document.getElementById("win-path");
  const canvas = document.getElementById("fx-canvas");
  const ctx = canvas.getContext("2d");

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

  const cellPoints = [
    [16.67, 16.67],
    [50, 16.67],
    [83.33, 16.67],
    [16.67, 50],
    [50, 50],
    [83.33, 50],
    [16.67, 83.33],
    [50, 83.33],
    [83.33, 83.33],
  ];

  const difficulties = ["Soft", "Sharp", "Pure"];

  const state = {
    board: Array(9).fill(null),
    turn: "X",
    mode: "ai",
    difficulty: "Sharp",
    pulse: true,
    gameOver: false,
    round: 1,
    scores: { X: 0, O: 0, draw: 0 },
    orders: { X: [], O: [] },
    vanishing: new Map(),
    winCombo: null,
    sound: true,
    locked: false,
    online: {
      available: false,
      connected: false,
      connecting: false,
      roomId: "",
      player: null,
      host: false,
      players: { X: false, O: false },
      spectators: 0,
      notice: "",
      revision: 0,
    },
  };

  const fx = {
    dpr: 1,
    width: 0,
    height: 0,
    pointer: { x: 0, y: 0, active: false },
    particles: [],
    ripples: [],
  };

  let audioContext = null;
  let aiTimer = null;
  let onlineSocket = null;
  let pendingOnlineAction = null;

  function render() {
    document.body.classList.toggle("turn-x", state.turn === "X");
    document.body.classList.toggle("turn-o", state.turn === "O");
    document.body.classList.toggle("is-locked", state.locked);
    document.body.classList.toggle("sound-off", !state.sound);
    document.body.classList.toggle("is-online", state.mode === "online");
    document.documentElement.style.setProperty("--accent", state.turn === "X" ? X_COLOR : O_COLOR);

    roundLabel.textContent = `Round ${state.round}`;
    scoreX.textContent = state.scores.X;
    scoreO.textContent = state.scores.O;
    scoreDraw.textContent = state.scores.draw;

    cells.forEach((cell, index) => {
      const piece = state.board[index] || state.vanishing.get(index);
      const previousPiece = cell.dataset.value || "";
      const isVanishing = state.vanishing.has(index);
      const isOldest =
        !isVanishing &&
        state.pulse &&
        piece &&
        state.orders[piece].length === 3 &&
        state.orders[piece][0] === index;
      const isWin = state.winCombo && state.winCombo.includes(index);
      const onlineBlocked =
        state.mode === "online" &&
        (!state.online.roomId ||
          !state.online.player ||
          !state.online.players.X ||
          !state.online.players.O ||
          state.online.player !== state.turn);
      const disabled =
        Boolean(state.board[index]) ||
        state.gameOver ||
        state.locked ||
        (state.mode === "ai" && state.turn === "O") ||
        onlineBlocked;

      cell.className = "cell";
      cell.disabled = disabled;
      cell.dataset.value = piece || "";
      cell.setAttribute("aria-label", labelForCell(index, piece));

      if (piece) {
        cell.classList.add("is-filled", piece === "X" ? "has-x" : "has-o");
        cell.style.setProperty("--piece-color", piece === "X" ? X_COLOR : O_COLOR);
      } else {
        cell.style.removeProperty("--piece-color");
      }

      if (isOldest) {
        cell.classList.add("is-oldest");
      }

      if (isVanishing) {
        cell.classList.add("is-vanishing");
      }

      if (isWin) {
        cell.classList.add("is-win");
      }

      if (previousPiece !== (piece || "")) {
        cell.innerHTML = piece ? markSvg(piece) : "";
      }
    });

    pulseToggle.classList.toggle("is-on", state.pulse);
    pulseToggle.setAttribute("aria-pressed", String(state.pulse));
    pulseToggle.querySelector("strong").textContent = state.pulse ? "On" : "Off";
    pulseToggle.disabled = state.mode === "online" && (!state.online.roomId || !state.online.host);

    modeButtons.forEach((button) => {
      const isActive = button.dataset.mode === state.mode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    difficultyLabel.textContent = state.difficulty;
    difficultyBtn.disabled = state.mode !== "ai";
    difficultyBtn.style.opacity = state.mode === "ai" ? "1" : "0.48";
    resetBtn.disabled = state.mode === "online" && (!state.online.roomId || !state.online.host);
    onlinePanel.hidden = state.mode !== "online";
    roomCode.textContent = state.online.roomId || "No room";
    onlineStatus.textContent = onlineDetailText();
    createRoomBtn.disabled = state.mode !== "online" || !state.online.available || state.online.connecting;
    joinRoomBtn.disabled = state.mode !== "online" || !state.online.available || state.online.connecting;
    leaveRoomBtn.disabled = state.mode !== "online" || !state.online.roomId;

    if (state.winCombo) {
      const [start, , end] = state.winCombo;
      const a = cellPoints[start];
      const b = cellPoints[end];
      winPath.setAttribute("d", `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`);
      winLine.classList.add("is-active");
      winPath.style.stroke = state.board[start] ? colorFor(state.board[start]) : "var(--accent)";
    } else {
      winPath.setAttribute("d", "");
      winLine.classList.remove("is-active");
      winPath.style.stroke = "var(--accent)";
    }
  }

  function labelForCell(index, piece) {
    const names = [
      "top left",
      "top center",
      "top right",
      "middle left",
      "center",
      "middle right",
      "bottom left",
      "bottom center",
      "bottom right",
    ];

    return piece ? `${names[index]}, ${piece}` : `${names[index]}, empty`;
  }

  function markSvg(piece) {
    if (piece === "X") {
      return [
        '<svg viewBox="0 0 100 100" aria-hidden="true">',
        '<path class="halo" pathLength="1" d="M16 16 L84 84" />',
        '<path class="x-a" pathLength="1" d="M22 20 C38 39 58 60 78 80" />',
        '<path class="x-b" pathLength="1" d="M78 20 C58 39 39 58 22 80" />',
        "</svg>",
      ].join("");
    }

    return [
      '<svg viewBox="0 0 100 100" aria-hidden="true">',
      '<circle class="halo" pathLength="1" cx="50" cy="50" r="39" />',
      '<circle pathLength="1" cx="50" cy="50" r="29" />',
      "</svg>",
    ].join("");
  }

  function colorFor(piece) {
    return piece === "X" ? X_COLOR : O_COLOR;
  }

  function canPlay(index) {
    if (state.gameOver || state.locked || state.board[index]) {
      return false;
    }

    if (state.mode === "online") {
      return Boolean(
        state.online.roomId &&
          state.online.player &&
          state.online.players.X &&
          state.online.players.O &&
          state.online.player === state.turn,
      );
    }

    return true;
  }

  function handleCellClick(event) {
    const cell = event.currentTarget;
    const index = Number(cell.dataset.cell);

    if (state.mode === "online") {
      if (!canPlay(index)) {
        pulseAtCell(index, INK_COLOR, 5);
        playTone(96, 0.06, "sine", 0.04);
        return;
      }

      state.locked = true;
      render();
      sendOnline({ type: "move", index });
      return;
    }

    if (state.mode === "ai" && state.turn === "O") {
      return;
    }

    if (!canPlay(index)) {
      pulseAtCell(index, INK_COLOR, 5);
      playTone(96, 0.06, "sine", 0.04);
      return;
    }

    commitMove(index);
  }

  function commitMove(index) {
    if (!canPlay(index)) {
      return false;
    }

    const player = state.turn;
    state.board[index] = player;
    state.orders[player].push(index);

    pulseAtCell(index, colorFor(player), 18);
    burstAtCell(index, colorFor(player), 28);
    playMoveSound(player);

    if (state.pulse && state.orders[player].length > 3) {
      const removedIndex = state.orders[player].shift();
      if (removedIndex !== index) {
        const removedPiece = state.board[removedIndex];
        state.board[removedIndex] = null;
        state.vanishing.set(removedIndex, removedPiece);
        pulseAtCell(removedIndex, colorFor(player), 8);
        window.setTimeout(() => {
          state.vanishing.delete(removedIndex);
          render();
        }, 340);
      }
    }

    const result = evaluateBoard(state.board);
    if (result.winner) {
      finishRound(result.winner, result.combo);
    } else if (!state.pulse && result.draw) {
      finishRound("draw", null);
    } else {
      state.turn = player === "X" ? "O" : "X";
      updateStatus();
    }

    render();

    if (!state.gameOver && state.mode === "ai" && state.turn === "O") {
      scheduleAiMove();
    }

    return true;
  }

  function updateStatus() {
    if (state.mode === "online") {
      if (!state.online.available) {
        statusText.textContent = "Start the server, then reopen through localhost.";
      } else if (state.online.connecting) {
        statusText.textContent = "Connecting to the game server.";
      } else if (!state.online.roomId) {
        statusText.textContent = "Create a room or enter a code.";
      } else if (!state.online.players.O) {
        statusText.textContent = `Room ${state.online.roomId}. Waiting for O.`;
      } else if (!state.online.player) {
        statusText.textContent = `Spectating ${state.online.roomId}. ${state.turn} to move.`;
      } else if (state.gameOver && state.winCombo) {
        statusText.textContent =
          state.turn === state.online.player ? "You connected the line." : `${state.turn} connected the line.`;
      } else if (state.gameOver) {
        statusText.textContent = "Grid locked. No winner.";
      } else if (state.turn === state.online.player) {
        statusText.textContent = `Your move as ${state.online.player}.`;
      } else {
        statusText.textContent = `${state.turn} is choosing a square.`;
      }
      return;
    }

    if (state.mode === "ai") {
      statusText.textContent =
        state.turn === "X" ? "Your move. Claim a square." : "AI is reading the grid.";
    } else {
      statusText.textContent = `${state.turn} to play.`;
    }
  }

  function onlineDetailText() {
    if (!state.online.available) {
      return "Run node server.js and open http://localhost:3000.";
    }

    if (state.online.connecting) {
      return "Opening a socket to the local server.";
    }

    if (!state.online.roomId) {
      return state.online.notice || "Create a room or join a code.";
    }

    const role = state.online.player || "Spectator";
    const host = state.online.host ? "host" : "guest";
    const waiting = state.online.players.O ? "" : " Waiting for another player.";
    const notice = state.online.notice ? ` ${state.online.notice}` : "";
    return `${role} · ${host}.${waiting}${notice}`;
  }

  function finishRound(winner, combo) {
    state.gameOver = true;
    state.locked = false;
    state.winCombo = combo;

    if (winner === "draw") {
      state.scores.draw += 1;
      statusText.textContent = "Grid locked. No winner.";
      playTone(142, 0.1, "triangle", 0.06);
      playTone(112, 0.15, "triangle", 0.05, 0.08);
      return;
    }

    state.scores[winner] += 1;
    statusText.textContent = winner === "X" ? "X connects the line." : "O breaks through.";
    state.turn = winner;
    burstAlongCombo(combo, colorFor(winner));
    playWinSound(winner);
  }

  function scheduleAiMove() {
    window.clearTimeout(aiTimer);
    state.locked = true;
    render();

    aiTimer = window.setTimeout(() => {
      const index = chooseAiMove();
      state.locked = false;

      if (index !== null) {
        commitMove(index);
      } else {
        render();
      }
    }, 460 + Math.random() * 260);
  }

  function chooseAiMove() {
    const empty = emptyCells(state.board);
    if (!empty.length) {
      return null;
    }

    if (state.difficulty === "Soft" && Math.random() < 0.54) {
      return randomItem(empty);
    }

    if (state.difficulty === "Pure" && !state.pulse) {
      return minimaxMove(state.board);
    }

    const win = tacticalMove("O");
    if (win !== null) {
      return win;
    }

    const block = tacticalMove("X");
    if (block !== null) {
      return block;
    }

    return scoredMove(empty);
  }

  function tacticalMove(player) {
    const empty = emptyCells(state.board);

    for (const index of empty) {
      const projected = simulateMove(index, player, state.board, state.orders, state.pulse);
      const result = evaluateBoard(projected.board);
      if (result.winner === player) {
        return index;
      }
    }

    return null;
  }

  function scoredMove(empty) {
    const scores = empty.map((index) => {
      const projected = simulateMove(index, "O", state.board, state.orders, state.pulse);
      const board = projected.board;
      let score = 0;

      if (index === 4) {
        score += 8;
      } else if ([0, 2, 6, 8].includes(index)) {
        score += 5;
      } else {
        score += 2;
      }

      for (const combo of winCombos) {
        const values = combo.map((slot) => board[slot]);
        const own = values.filter((value) => value === "O").length;
        const rival = values.filter((value) => value === "X").length;

        if (rival === 0) {
          score += own * own * 4;
        }

        if (own === 0) {
          score += rival * 2;
        }

        if (rival === 2 && own === 0) {
          score += 9;
        }
      }

      score += Math.random() * (state.difficulty === "Pure" ? 0.4 : 2.2);
      return { index, score };
    });

    scores.sort((a, b) => b.score - a.score);
    return scores[0].index;
  }

  function simulateMove(index, player, board, orders, pulse) {
    const nextBoard = board.slice();
    const nextOrders = {
      X: orders.X.slice(),
      O: orders.O.slice(),
    };

    nextBoard[index] = player;
    nextOrders[player].push(index);

    if (pulse && nextOrders[player].length > 3) {
      const removed = nextOrders[player].shift();
      nextBoard[removed] = null;
    }

    return { board: nextBoard, orders: nextOrders };
  }

  function minimaxMove(board) {
    let bestScore = -Infinity;
    let bestMove = null;

    for (const index of emptyCells(board)) {
      const nextBoard = board.slice();
      nextBoard[index] = "O";
      const score = minimax(nextBoard, 0, false);

      if (score > bestScore) {
        bestScore = score;
        bestMove = index;
      }
    }

    return bestMove;
  }

  function minimax(board, depth, isMaximizing) {
    const result = evaluateBoard(board);

    if (result.winner === "O") {
      return 10 - depth;
    }

    if (result.winner === "X") {
      return depth - 10;
    }

    if (result.draw) {
      return 0;
    }

    if (isMaximizing) {
      let best = -Infinity;
      for (const index of emptyCells(board)) {
        const nextBoard = board.slice();
        nextBoard[index] = "O";
        best = Math.max(best, minimax(nextBoard, depth + 1, false));
      }
      return best;
    }

    let best = Infinity;
    for (const index of emptyCells(board)) {
      const nextBoard = board.slice();
      nextBoard[index] = "X";
      best = Math.min(best, minimax(nextBoard, depth + 1, true));
    }
    return best;
  }

  function emptyCells(board) {
    return board
      .map((value, index) => (value ? null : index))
      .filter((value) => value !== null);
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
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

  function resetRound(options) {
    const keepRound = options && options.keepRound;
    window.clearTimeout(aiTimer);
    state.board = Array(9).fill(null);
    state.turn = "X";
    state.gameOver = false;
    state.locked = false;
    state.orders = { X: [], O: [] };
    state.vanishing.clear();
    state.winCombo = null;

    if (!keepRound) {
      state.round += 1;
    }

    updateStatus();
    clearWinLineAnimation();
    render();
    pulseAtBoard(INK_COLOR, 10);
  }

  function clearWinLineAnimation() {
    winLine.classList.remove("is-active");
    void winLine.offsetWidth;
  }

  function cycleDifficulty() {
    const current = difficulties.indexOf(state.difficulty);
    state.difficulty = difficulties[(current + 1) % difficulties.length];
    render();
  }

  function setMode(mode) {
    if (state.mode === mode) {
      return;
    }

    if (state.mode === "online" && mode !== "online") {
      sendOnline({ type: "leaveRoom" });
      clearOnlineRoom();
    }

    state.mode = mode;

    if (mode === "online") {
      resetRound({ keepRound: true });
      ensureOnlineConnection();
      return;
    }

    resetRound({ keepRound: false });
  }

  function togglePulse() {
    if (state.mode === "online") {
      if (state.online.roomId && state.online.host) {
        sendOnline({ type: "setPulse", pulse: !state.pulse });
      }
      return;
    }

    state.pulse = !state.pulse;
    resetRound({ keepRound: false });
  }

  function toggleSound() {
    state.sound = !state.sound;
    soundBtn.setAttribute("aria-pressed", String(state.sound));
    render();

    if (state.sound) {
      playTone(260, 0.08, "sine", 0.04);
      playTone(392, 0.1, "sine", 0.035, 0.07);
    }
  }

  function canUseOnline() {
    return location.protocol !== "file:" && Boolean(location.host) && "WebSocket" in window;
  }

  function onlineUrl() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/ws`;
  }

  function ensureOnlineConnection(afterOpen) {
    state.online.available = canUseOnline();

    if (!state.online.available) {
      state.online.notice = "Server unavailable from file mode.";
      updateStatus();
      render();
      return;
    }

    if (afterOpen) {
      pendingOnlineAction = afterOpen;
    }

    if (onlineSocket && onlineSocket.readyState === WebSocket.OPEN) {
      state.online.connected = true;
      state.online.connecting = false;
      const action = pendingOnlineAction;
      pendingOnlineAction = null;
      if (action) {
        action();
      }
      updateStatus();
      render();
      return;
    }

    if (onlineSocket && onlineSocket.readyState === WebSocket.CONNECTING) {
      return;
    }

    state.online.connecting = true;
    state.online.notice = "";
    updateStatus();
    render();

    onlineSocket = new WebSocket(onlineUrl());

    onlineSocket.addEventListener("open", () => {
      state.online.connected = true;
      state.online.connecting = false;
      state.online.notice = "";
      const action = pendingOnlineAction;
      pendingOnlineAction = null;
      if (action) {
        action();
      }
      updateStatus();
      render();
    });

    onlineSocket.addEventListener("message", (event) => {
      handleOnlineMessage(event.data);
    });

    onlineSocket.addEventListener("close", () => {
      state.online.connected = false;
      state.online.connecting = false;
      state.online.notice = "Disconnected from server.";
      state.locked = false;
      clearOnlineRoom();
      updateStatus();
      render();
    });

    onlineSocket.addEventListener("error", () => {
      state.online.connected = false;
      state.online.connecting = false;
      state.online.notice = "Could not reach server.";
      state.locked = false;
      updateStatus();
      render();
    });
  }

  function sendOnline(payload) {
    if (onlineSocket && onlineSocket.readyState === WebSocket.OPEN) {
      onlineSocket.send(JSON.stringify(payload));
      return;
    }

    ensureOnlineConnection(() => sendOnline(payload));
  }

  function handleOnlineMessage(raw) {
    let message;

    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === "hello") {
      state.online.connected = true;
      state.online.connecting = false;
    } else if (message.type === "error") {
      state.online.notice = message.message || "Server rejected the action.";
      state.locked = false;
      playTone(96, 0.06, "sine", 0.04);
    } else if (message.type === "leftRoom") {
      clearOnlineRoom();
    } else if (message.type === "state") {
      applyOnlineState(message);
    }

    updateStatus();
    render();
  }

  function applyOnlineState(message) {
    state.online.roomId = message.roomId || "";
    state.online.player = message.player || null;
    state.online.host = Boolean(message.host);
    state.online.players = {
      X: Boolean(message.players && message.players.X),
      O: Boolean(message.players && message.players.O),
    };
    state.online.spectators = Number(message.spectators || 0);
    state.online.revision = Number(message.revision || 0);
    state.locked = false;

    state.board = Array.isArray(message.board) ? message.board.slice(0, 9) : Array(9).fill(null);
    state.turn = message.turn === "O" ? "O" : "X";
    state.pulse = Boolean(message.pulse);
    state.gameOver = Boolean(message.gameOver);
    state.round = Number(message.round || 1);
    state.scores = {
      X: Number(message.scores && message.scores.X ? message.scores.X : 0),
      O: Number(message.scores && message.scores.O ? message.scores.O : 0),
      draw: Number(message.scores && message.scores.draw ? message.scores.draw : 0),
    };
    state.orders = {
      X: Array.isArray(message.orders && message.orders.X) ? message.orders.X.slice() : [],
      O: Array.isArray(message.orders && message.orders.O) ? message.orders.O.slice() : [],
    };
    state.winCombo = Array.isArray(message.winCombo) ? message.winCombo : null;

    const events = Array.isArray(message.events) ? message.events : [];
    for (const event of events) {
      applyOnlineEvent(event);
    }

    if (state.online.roomId && location.protocol !== "file:") {
      const url = new URL(location.href);
      url.searchParams.set("room", state.online.roomId);
      history.replaceState(null, "", url);
    }

    if (state.online.roomId && document.activeElement !== roomInput) {
      roomInput.value = state.online.roomId;
    }
  }

  function applyOnlineEvent(event) {
    if (!event || !event.type) {
      return;
    }

    if (event.type === "place") {
      pulseAtCell(event.index, colorFor(event.player), 18);
      burstAtCell(event.index, colorFor(event.player), 28);
      playMoveSound(event.player);
    } else if (event.type === "remove") {
      state.vanishing.set(event.index, event.player);
      pulseAtCell(event.index, colorFor(event.player), 8);
      window.setTimeout(() => {
        state.vanishing.delete(event.index);
        render();
      }, 340);
    } else if (event.type === "win") {
      burstAlongCombo(event.combo || [], colorFor(event.player));
      playWinSound(event.player);
    } else if (event.type === "draw") {
      playTone(142, 0.1, "triangle", 0.06);
      playTone(112, 0.15, "triangle", 0.05, 0.08);
    } else if (event.type === "reset") {
      state.vanishing.clear();
      clearWinLineAnimation();
      pulseAtBoard(INK_COLOR, 10);
    } else if (event.type === "notice") {
      state.online.notice = event.message || "";
    }
  }

  function clearOnlineRoom() {
    state.online.roomId = "";
    state.online.player = null;
    state.online.host = false;
    state.online.players = { X: false, O: false };
    state.online.spectators = 0;
    state.online.revision = 0;
    state.board = Array(9).fill(null);
    state.turn = "X";
    state.gameOver = false;
    state.locked = false;
    state.orders = { X: [], O: [] };
    state.vanishing.clear();
    state.winCombo = null;

    if (location.protocol !== "file:") {
      const url = new URL(location.href);
      url.searchParams.delete("room");
      history.replaceState(null, "", url);
    }

    if (document.activeElement !== roomInput) {
      roomInput.value = "";
    }
  }

  function joinTypedRoom() {
    const requestedRoom = roomInput.value.trim().toUpperCase();
    if (!requestedRoom) {
      state.online.notice = "Enter a room code first.";
      updateStatus();
      render();
      return;
    }

    state.mode = "online";
    ensureOnlineConnection(() => sendOnline({ type: "joinRoom", roomId: requestedRoom }));
    render();
  }

  function updatePointer(event) {
    const x = event.clientX;
    const y = event.clientY;
    fx.pointer.x = x;
    fx.pointer.y = y;
    fx.pointer.active = true;
    document.body.style.setProperty("--mx", `${x}px`);
    document.body.style.setProperty("--my", `${y}px`);
  }

  function updateCellTilt(event) {
    const cell = event.currentTarget;
    if (cell.disabled) {
      return;
    }

    const rect = cell.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    const tiltX = (0.5 - py) * 7;
    const tiltY = (px - 0.5) * 7;

    cell.style.setProperty("--cx", `${px * 100}%`);
    cell.style.setProperty("--cy", `${py * 100}%`);
    cell.style.setProperty("--tilt-x", `${tiltX}deg`);
    cell.style.setProperty("--tilt-y", `${tiltY}deg`);
  }

  function clearCellTilt(event) {
    const cell = event.currentTarget;
    cell.style.setProperty("--cx", "50%");
    cell.style.setProperty("--cy", "50%");
    cell.style.setProperty("--tilt-x", "0deg");
    cell.style.setProperty("--tilt-y", "0deg");
  }

  function resizeCanvas() {
    fx.dpr = Math.min(window.devicePixelRatio || 1, 2);
    fx.width = window.innerWidth;
    fx.height = window.innerHeight;
    canvas.width = Math.floor(fx.width * fx.dpr);
    canvas.height = Math.floor(fx.height * fx.dpr);
    canvas.style.width = `${fx.width}px`;
    canvas.style.height = `${fx.height}px`;
    ctx.setTransform(fx.dpr, 0, 0, fx.dpr, 0, 0);
  }

  function animate() {
    ctx.clearRect(0, 0, fx.width, fx.height);
    drawPointerField();
    drawRipples();
    drawParticles();
    requestAnimationFrame(animate);
  }

  function drawPointerField() {
    if (!fx.pointer.active) {
      return;
    }

    const color = state.turn === "X" ? X_COLOR : O_COLOR;
    const gradient = ctx.createRadialGradient(
      fx.pointer.x,
      fx.pointer.y,
      8,
      fx.pointer.x,
      fx.pointer.y,
      150,
    );

    gradient.addColorStop(0, rgba(color, 0.16));
    gradient.addColorStop(0.42, rgba(color, 0.08));
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(fx.pointer.x, fx.pointer.y, 150, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = rgba(color, 0.18);
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i += 1) {
      const radius = 24 + i * 17 + Math.sin(performance.now() / 360 + i) * 4;
      ctx.beginPath();
      ctx.arc(fx.pointer.x, fx.pointer.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawRipples() {
    for (let i = fx.ripples.length - 1; i >= 0; i -= 1) {
      const ripple = fx.ripples[i];
      const t = 1 - ripple.life / ripple.max;
      ripple.life -= 1;

      ctx.strokeStyle = rgba(ripple.color, (1 - t) * 0.52);
      ctx.lineWidth = 1.5 + t * 5;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, ripple.radius + t * ripple.spread, 0, Math.PI * 2);
      ctx.stroke();

      if (ripple.life <= 0) {
        fx.ripples.splice(i, 1);
      }
    }
  }

  function drawParticles() {
    for (let i = fx.particles.length - 1; i >= 0; i -= 1) {
      const particle = fx.particles[i];
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vx *= 0.985;
      particle.vy *= 0.985;
      particle.life -= 1;

      const alpha = Math.max(particle.life / particle.max, 0);
      ctx.fillStyle = rgba(particle.color, alpha * 0.8);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * (0.35 + alpha), 0, Math.PI * 2);
      ctx.fill();

      if (particle.life <= 0) {
        fx.particles.splice(i, 1);
      }
    }
  }

  function pulseAtCell(index, color, strength) {
    const center = getCellCenter(index);
    if (!center) {
      return;
    }

    fx.ripples.push({
      x: center.x,
      y: center.y,
      radius: 12,
      spread: 34 + strength * 2,
      life: 34,
      max: 34,
      color,
    });
  }

  function pulseAtBoard(color, strength) {
    const rect = boardEl.getBoundingClientRect();
    fx.ripples.push({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      radius: rect.width * 0.2,
      spread: rect.width * 0.42 + strength,
      life: 44,
      max: 44,
      color,
    });
  }

  function burstAtCell(index, color, count) {
    const center = getCellCenter(index);
    if (!center) {
      return;
    }

    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 5;
      fx.particles.push({
        x: center.x + (Math.random() - 0.5) * 18,
        y: center.y + (Math.random() - 0.5) * 18,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1.3 + Math.random() * 3.6,
        life: 30 + Math.random() * 28,
        max: 58,
        color,
      });
    }
  }

  function burstAlongCombo(combo, color) {
    for (const index of combo) {
      burstAtCell(index, color, 38);
      pulseAtCell(index, color, 18);
    }
  }

  function getCellCenter(index) {
    const cell = cells[index];
    if (!cell) {
      return null;
    }

    const rect = cell.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function rgba(hex, alpha) {
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function ensureAudio() {
    if (!state.sound) {
      return null;
    }

    if (!audioContext) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) {
        return null;
      }
      audioContext = new AudioCtor();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    return audioContext;
  }

  function playTone(frequency, duration, type, gainValue, delay) {
    const audio = ensureAudio();
    if (!audio) {
      return;
    }

    const start = audio.currentTime + (delay || 0);
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    oscillator.type = type || "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue || 0.05, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playMoveSound(player) {
    if (player === "X") {
      playTone(185, 0.09, "triangle", 0.04);
      playTone(370, 0.08, "sine", 0.03, 0.04);
    } else {
      playTone(246, 0.1, "triangle", 0.04);
      playTone(492, 0.08, "sine", 0.03, 0.04);
    }
  }

  function playWinSound(player) {
    const base = player === "X" ? 220 : 247;
    playTone(base, 0.12, "triangle", 0.07);
    playTone(base * 1.5, 0.14, "sine", 0.055, 0.08);
    playTone(base * 2, 0.18, "sine", 0.04, 0.16);
  }

  function bindEvents() {
    cells.forEach((cell) => {
      cell.addEventListener("click", handleCellClick);
      cell.addEventListener("pointermove", updateCellTilt);
      cell.addEventListener("pointerleave", clearCellTilt);
    });

    modeButtons.forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });

    pulseToggle.addEventListener("click", togglePulse);
    difficultyBtn.addEventListener("click", cycleDifficulty);
    soundBtn.addEventListener("click", toggleSound);
    resetBtn.addEventListener("click", () => {
      if (state.mode === "online") {
        sendOnline({ type: "resetRound" });
        return;
      }

      resetRound({ keepRound: false });
    });
    createRoomBtn.addEventListener("click", () => {
      state.mode = "online";
      ensureOnlineConnection(() => sendOnline({ type: "createRoom" }));
      render();
    });
    joinRoomBtn.addEventListener("click", joinTypedRoom);
    leaveRoomBtn.addEventListener("click", () => {
      sendOnline({ type: "leaveRoom" });
      clearOnlineRoom();
      updateStatus();
      render();
    });
    roomInput.addEventListener("input", () => {
      roomInput.value = roomInput.value.replace(/[^a-z0-9]/gi, "").toUpperCase();
    });
    roomInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        joinTypedRoom();
      }
    });
    window.addEventListener("pointermove", updatePointer, { passive: true });
    window.addEventListener("pointerleave", () => {
      fx.pointer.active = false;
    });
    window.addEventListener("resize", resizeCanvas);
  }

  function init() {
    state.online.available = canUseOnline();
    bindEvents();
    resizeCanvas();

    const initialRoom = new URLSearchParams(location.search).get("room");
    if (initialRoom && state.online.available) {
      state.mode = "online";
      roomInput.value = initialRoom.trim().toUpperCase();
      ensureOnlineConnection(() => sendOnline({ type: "joinRoom", roomId: roomInput.value }));
    }

    updateStatus();
    render();
    pulseAtBoard(INK_COLOR, 10);
    requestAnimationFrame(animate);
  }

  init();
})();

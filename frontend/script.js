// ==================================================
// Chaturanga AI - Frontend Controller
// ==================================================

const API_BASE = window.location.port === "5500"
    ? "http://127.0.0.1:8000"
    : window.location.origin;
const API_URL = `${API_BASE}/ask`;

// --------------------------------------------------
// 1. State & DOM Elements
// --------------------------------------------------

const chatForm = document.getElementById("chatForm");
const questionInput = document.getElementById("questionInput");
const sendBtn = document.getElementById("sendBtn");
const messages = document.getElementById("messages");
const welcomeScreen = document.getElementById("welcomeScreen");
const newChatBtn = document.getElementById("newChatBtn");
const toastEl = document.getElementById("toast");
const sessionsList = document.getElementById("sessionsList");

// Chessboard elements
const chessboard = document.getElementById("chessboard");
const resetBoardBtn = document.getElementById("resetBoardBtn");
const undoMoveBtn = document.getElementById("undoMoveBtn");
const redoMoveBtn = document.getElementById("redoMoveBtn");
const flipBoardBtn = document.getElementById("flipBoardBtn");
const copyFenBtn = document.getElementById("copyFenBtn");
const askAiPosBtn = document.getElementById("askAiPosBtn");
const turnIndicator = document.getElementById("turnIndicator");
const moveHistory = document.getElementById("moveHistory");
const moveCountBadge = document.getElementById("moveCountBadge");

// Responsive / Mobile elements
const tabBoardBtn = document.getElementById("tabBoardBtn");
const tabChatBtn = document.getElementById("tabChatBtn");
const chessboardSection = document.getElementById("chessboardSection");
const chatMain = document.getElementById("chatMain");
const sidebar = document.getElementById("sidebar");
const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");

let isLoading = false;
let isFlipped = false;
let toastTimeout = null;
const redoStack = [];
const game = new Chess();
let selectedSquare = null;

const SESSION_STORAGE_KEY = "chaturanga_session_id";
let sessionId = localStorage.getItem(SESSION_STORAGE_KEY);

if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
}

// --------------------------------------------------
// 2. Toast Notifications (Replaces intrusive alerts)
// --------------------------------------------------

function showToast(message, type = "info") {
    if (!toastEl) return;

    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }

    toastEl.textContent = message;
    toastEl.className = `toast show ${type}`;

    toastTimeout = setTimeout(() => {
        toastEl.classList.remove("show");
    }, 3200);
}

// --------------------------------------------------
// 3. Mobile View Switcher
// --------------------------------------------------

function setActiveMobileView(view) {
    if (window.innerWidth > 1024) {
        chessboardSection?.classList.remove("active-view");
        chatMain?.classList.remove("active-view");
        return;
    }

    if (view === "board") {
        tabBoardBtn?.classList.add("active");
        tabChatBtn?.classList.remove("active");
        chessboardSection?.classList.add("active-view");
        chatMain?.classList.remove("active-view");
    } else {
        tabChatBtn?.classList.add("active");
        tabBoardBtn?.classList.remove("active");
        chatMain?.classList.add("active-view");
        chessboardSection?.classList.remove("active-view");
    }
}

tabBoardBtn?.addEventListener("click", () => setActiveMobileView("board"));
tabChatBtn?.addEventListener("click", () => setActiveMobileView("chat"));

// Sidebar Drawer toggle for mobile
sidebarToggleBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    sidebar?.classList.toggle("open");
});

document.addEventListener("click", (e) => {
    if (sidebar?.classList.contains("open") && !sidebar.contains(e.target) && e.target !== sidebarToggleBtn) {
        sidebar.classList.remove("open");
    }
});

window.addEventListener("resize", () => {
    if (window.innerWidth > 1024) {
        chessboardSection?.classList.remove("active-view");
        chatMain?.classList.remove("active-view");
        sidebar?.classList.remove("open");
    } else {
        if (!chessboardSection?.classList.contains("active-view") && !chatMain?.classList.contains("active-view")) {
            setActiveMobileView("board");
        }
    }
});

if (window.innerWidth <= 1024) {
    setActiveMobileView("board");
}

// --------------------------------------------------
// 4. Session History Management (ChatGPT / Claude style)
// --------------------------------------------------

function updateActiveSessionInList() {
    document.querySelectorAll(".session-item").forEach(item => {
        item.classList.toggle("active", item.dataset.sessionId === sessionId);
    });
}

async function loadSessionsList() {
    if (!sessionsList) return;

    try {
        const response = await fetch(`${API_BASE}/sessions`);
        if (!response.ok) return;

        const data = await response.json();
        const sessions = data.sessions || [];

        if (sessions.length === 0) {
            sessionsList.innerHTML = '<p class="empty-sessions">No conversations yet</p>';
            return;
        }

        sessionsList.innerHTML = "";

        sessions.forEach(sess => {
            const item = document.createElement("div");
            item.className = `session-item ${sess.session_id === sessionId ? "active" : ""}`;
            item.dataset.sessionId = sess.session_id;

            const titleWrapper = document.createElement("div");
            titleWrapper.className = "session-title-wrapper";
            titleWrapper.title = sess.title;

            const icon = document.createElement("span");
            icon.className = "session-icon";
            icon.textContent = "💬";

            const title = document.createElement("span");
            title.className = "session-title";
            title.textContent = sess.title;

            titleWrapper.appendChild(icon);
            titleWrapper.appendChild(title);

            const deleteBtn = document.createElement("button");
            deleteBtn.className = "session-delete-btn";
            deleteBtn.innerHTML = "✕";
            deleteBtn.title = "Delete conversation";
            deleteBtn.setAttribute("aria-label", "Delete conversation");

            deleteBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                deleteSession(sess.session_id);
            });

            item.appendChild(titleWrapper);
            item.appendChild(deleteBtn);

            item.addEventListener("click", () => {
                switchToSession(sess.session_id);
            });

            sessionsList.appendChild(item);
        });

    } catch (err) {
        console.error("Failed to load sessions:", err);
    }
}

async function switchToSession(targetSessionId) {
    if (isLoading) return;
    if (targetSessionId === sessionId) {
        setActiveMobileView("chat");
        sidebar?.classList.remove("open");
        return;
    }

    sessionId = targetSessionId;
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);

    updateActiveSessionInList();
    await loadConversationHistory();

    setActiveMobileView("chat");
    sidebar?.classList.remove("open");
}

async function deleteSession(targetSessionId) {
    try {
        const response = await fetch(`${API_BASE}/sessions/${encodeURIComponent(targetSessionId)}`, {
            method: "DELETE"
        });

        if (!response.ok) throw new Error("Failed to delete session");

        showToast("Conversation deleted");

        if (targetSessionId === sessionId) {
            startNewConversation();
        } else {
            loadSessionsList();
        }
    } catch (err) {
        console.error("Delete session error:", err);
        showToast("Could not delete conversation", "danger");
    }
}

function startNewConversation() {
    if (isLoading) return;

    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);

    messages.innerHTML = "";
    if (welcomeScreen) welcomeScreen.style.display = "block";
    questionInput.value = "";
    questionInput.focus();
    sidebar?.classList.remove("open");

    updateActiveSessionInList();
    showToast("Started a new conversation");
}

newChatBtn?.addEventListener("click", startNewConversation);

// --------------------------------------------------
// 5. Chat Messages Display & History
// --------------------------------------------------

function addMessage(text, sender, isError = false) {
    const message = document.createElement("div");
    message.className = `message ${sender}`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = sender === "user" ? "YOU" : "♞";

    const content = document.createElement("div");
    content.className = "message-content";

    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = sender === "user" ? "YOU" : "CHATURANGA AI";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (sender === "assistant") {
        bubble.innerHTML = DOMPurify.sanitize(marked.parse(text));
    } else {
        bubble.textContent = text;
    }

    if (isError) {
        bubble.classList.add("error");
    }

    content.appendChild(label);
    content.appendChild(bubble);

    message.appendChild(avatar);
    message.appendChild(content);

    messages.appendChild(message);

    message.scrollIntoView({
        behavior: "smooth",
        block: "end"
    });

    return message;
}

async function loadConversationHistory() {
    try {
        const response = await fetch(
            `${API_BASE}/history/${encodeURIComponent(sessionId)}`
        );

        if (!response.ok) {
            throw new Error("Failed to load conversation history");
        }

        const data = await response.json();
        messages.innerHTML = "";

        if (data.messages && data.messages.length > 0) {
            if (welcomeScreen) welcomeScreen.style.display = "none";

            data.messages.forEach((message) => {
                const sender = message.role === "user" ? "user" : "assistant";
                addMessage(message.content, sender);
            });
        } else {
            if (welcomeScreen) welcomeScreen.style.display = "block";
        }
    } catch (error) {
        console.error("History loading error:", error);
    }
}

// Initial bootstrap
loadConversationHistory();
loadSessionsList();

// Typing indicator
function showTypingIndicator() {
    const indicator = document.createElement("div");
    indicator.className = "message";
    indicator.id = "typingIndicator";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "♞";

    const text = document.createElement("div");
    text.className = "typing";
    text.textContent = "Chaturanga AI is analyzing...";

    indicator.appendChild(avatar);
    indicator.appendChild(text);

    messages.appendChild(indicator);

    indicator.scrollIntoView({
        behavior: "smooth",
        block: "end"
    });
}

function removeTypingIndicator() {
    document.getElementById("typingIndicator")?.remove();
}

// --------------------------------------------------
// 6. Send Question Pipeline
// --------------------------------------------------

async function sendQuestion(question) {
    question = question.trim();

    if (!question || isLoading) {
        return;
    }

    if (welcomeScreen) welcomeScreen.style.display = "none";

    addMessage(question, "user");

    questionInput.value = "";
    questionInput.style.height = "auto";

    isLoading = true;
    sendBtn.disabled = true;

    showTypingIndicator();

    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                question: question,
                session_id: sessionId
            })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();

        removeTypingIndicator();

        if (data.error) {
            addMessage(data.error, "assistant", true);
        } else {
            addMessage(
                data.answer || "No answer was returned.",
                "assistant"
            );
        }

        // Refresh sessions list in sidebar to reflect new title or activity order
        loadSessionsList();

    } catch (error) {
        removeTypingIndicator();
        console.error("Chat error:", error);

        addMessage(
            "I couldn't connect to the chess server. " +
            "Make sure your FastAPI backend is running " +
            "at http://127.0.0.1:8000 and try again.",
            "assistant",
            true
        );
    } finally {
        isLoading = false;
        sendBtn.disabled = false;
        questionInput.focus();
    }
}

chatForm.addEventListener("submit", function (event) {
    event.preventDefault();
    sendQuestion(questionInput.value);
});

questionInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        chatForm.requestSubmit();
    }
});

questionInput.addEventListener("input", function () {
    questionInput.style.height = "auto";
    questionInput.style.height = Math.min(questionInput.scrollHeight, 140) + "px";
});

// Sidebar & suggestion buttons
document.querySelectorAll("[data-question]").forEach(button => {
    button.addEventListener("click", function () {
        const question = this.dataset.question;
        if (question) {
            setActiveMobileView("chat");
            sendQuestion(question);
            sidebar?.classList.remove("open");
        }
    });
});

// --------------------------------------------------
// 7. Interactive Chessboard Implementation
// --------------------------------------------------

const pieceSymbols = {
    w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
    b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }
};

function renderBoard() {
    chessboard.innerHTML = "";

    const board = game.board();
    const legalMoves = selectedSquare
        ? game.moves({ square: selectedSquare, verbose: true })
        : [];
    const legalTargets = legalMoves.map(move => move.to);

    for (let displayRow = 0; displayRow < 8; displayRow++) {
        for (let displayCol = 0; displayCol < 8; displayCol++) {
            const actualRow = isFlipped ? 7 - displayRow : displayRow;
            const actualCol = isFlipped ? 7 - displayCol : displayCol;

            const square = document.createElement("div");
            square.classList.add("chess-square");

            const isLight = (actualRow + actualCol) % 2 === 0;
            square.classList.add(isLight ? "light" : "dark");

            const piece = board[actualRow][actualCol];

            if (piece) {
                square.textContent = pieceSymbols[piece.color][piece.type];
                square.classList.add(piece.color === "w" ? "white-piece" : "black-piece");
            }

            const squareName = String.fromCharCode(97 + actualCol) + (8 - actualRow);
            square.dataset.square = squareName;

            // Render subtle rank coordinate on leftmost column
            if (displayCol === 0) {
                const rankSpan = document.createElement("span");
                rankSpan.className = "coord-rank";
                rankSpan.textContent = (8 - actualRow);
                square.appendChild(rankSpan);
            }

            // Render subtle file coordinate on bottom row
            if (displayRow === 7) {
                const fileSpan = document.createElement("span");
                fileSpan.className = "coord-file";
                fileSpan.textContent = String.fromCharCode(97 + actualCol);
                square.appendChild(fileSpan);
            }

            if (selectedSquare === squareName) {
                square.classList.add("selected");
            }

            if (legalTargets.includes(squareName)) {
                square.classList.add("legal-move");
                if (piece) {
                    square.classList.add("legal-capture");
                }
            }

            square.addEventListener("click", () => {
                handleSquareClick(squareName);
            });

            chessboard.appendChild(square);
        }
    }
}

function updateUndoRedoButtons() {
    undoMoveBtn.disabled = game.history().length === 0;
    redoMoveBtn.disabled = redoStack.length === 0;
}

function updateGameInfo() {
    turnIndicator.className = "turn-indicator";

    // Valid check and checkmate detection via chess.js 0.10.3 API
    if (game.in_checkmate()) {
        const winner = game.turn() === "w" ? "Black" : "White";
        turnIndicator.textContent = `Checkmate! ${winner} wins!`;
        turnIndicator.classList.add("checkmate");
    } else if (game.in_draw()) {
        turnIndicator.textContent = "Game Over — Draw!";
    } else if (game.in_check()) {
        const checkedColor = game.turn() === "w" ? "White" : "Black";
        turnIndicator.textContent = `${checkedColor} King is in Check!`;
        turnIndicator.classList.add("check");
    } else {
        const turnColor = game.turn() === "w" ? "White" : "Black";
        turnIndicator.textContent = `${turnColor}'s Turn`;
    }

    updateUndoRedoButtons();

    // Update move history
    const history = game.history();

    if (moveCountBadge) {
        moveCountBadge.textContent = `${history.length} move${history.length === 1 ? '' : 's'}`;
    }

    if (history.length === 0) {
        moveHistory.innerHTML = '<p class="empty-history">No moves yet</p>';
        return;
    }

    moveHistory.innerHTML = "";

    for (let i = 0; i < history.length; i += 2) {
        const moveNumber = Math.floor(i / 2) + 1;
        const whiteMove = history[i];
        const blackMove = history[i + 1] || "";

        const moveRow = document.createElement("div");
        moveRow.classList.add("move-row");

        const number = document.createElement("span");
        number.classList.add("move-number");
        number.textContent = `${moveNumber}.`;

        const white = document.createElement("span");
        white.classList.add("white-move");
        white.textContent = whiteMove;

        const black = document.createElement("span");
        black.classList.add("black-move");
        black.textContent = blackMove;

        moveRow.append(number, white, black);
        moveHistory.appendChild(moveRow);
    }

    moveHistory.scrollTop = moveHistory.scrollHeight;
}

function handleSquareClick(squareName) {
    const piece = game.get(squareName);

    if (selectedSquare === null) {
        if (piece && piece.color === game.turn()) {
            selectedSquare = squareName;
            renderBoard();
        }
        return;
    }

    if (selectedSquare === squareName) {
        selectedSquare = null;
        renderBoard();
        return;
    }

    const move = game.move({
        from: selectedSquare,
        to: squareName,
        promotion: "q"
    });

    if (move) {
        selectedSquare = null;
        redoStack.length = 0;
        renderBoard();
        updateGameInfo();

        if (game.in_checkmate()) {
            const winner = game.turn() === "w" ? "Black" : "White";
            showToast(`Checkmate! ${winner} wins!`, "danger");
        } else if (game.in_draw()) {
            showToast("Game ended in a draw.");
        } else if (game.in_check()) {
            const checkedColor = game.turn() === "w" ? "White" : "Black";
            showToast(`Check! ${checkedColor} is in check!`, "danger");
        }

        return;
    }

    if (piece && piece.color === game.turn()) {
        selectedSquare = squareName;
    } else {
        selectedSquare = null;
    }

    renderBoard();
}

function resetBoard() {
    game.reset();
    redoStack.length = 0;
    selectedSquare = null;
    renderBoard();
    updateGameInfo();
    showToast("Board reset to starting position");
}

function undoMove() {
    const undoneMove = game.undo();

    if (undoneMove) {
        redoStack.push(undoneMove);
        selectedSquare = null;
        renderBoard();
        updateGameInfo();
    }
}

function redoMove() {
    if (redoStack.length === 0) return;

    const move = redoStack.pop();

    game.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion
    });

    selectedSquare = null;
    renderBoard();
    updateGameInfo();
}

function flipBoard() {
    isFlipped = !isFlipped;
    renderBoard();
    showToast(isFlipped ? "Viewing board as Black" : "Viewing board as White");
}

function copyFen() {
    const fen = game.fen();
    navigator.clipboard.writeText(fen).then(() => {
        showToast("FEN copied to clipboard!");
    }).catch(() => {
        showToast(`FEN: ${fen}`);
    });
}

// --------------------------------------------------
// 8. Board-to-Chat AI Analysis Interaction
// --------------------------------------------------

function askAiAboutCurrentPosition() {
    const fen = game.fen();
    const history = game.history();
    const turnStr = game.turn() === "w" ? "White" : "Black";
    
    let status = `${turnStr} to move.`;
    if (game.in_checkmate()) {
        status = `Checkmate! ${game.turn() === "w" ? "Black" : "White"} has won.`;
    } else if (game.in_check()) {
        status = `${turnStr} is currently in check!`;
    } else if (game.in_draw()) {
        status = "The game is drawn.";
    }

    let moveList = "";
    if (history.length > 0) {
        const movesFormatted = [];
        for (let i = 0; i < history.length; i += 2) {
            const num = Math.floor(i / 2) + 1;
            const w = history[i];
            const b = history[i + 1] ? ` ${history[i + 1]}` : "";
            movesFormatted.push(`${num}. ${w}${b}`);
        }
        moveList = movesFormatted.join(" ");
    } else {
        moveList = "Game at starting position (1. e4 / 1. d4 opening phase).";
    }

    const question = `Here is my current chess position:
- FEN: ${fen}
- Moves played: ${moveList}
- Status: ${status}

Can you analyze this position, explain the key strategic ideas for both sides, and suggest what ${turnStr} should do next?`;

    setActiveMobileView("chat");
    sendQuestion(question);
}

// --------------------------------------------------
// 9. Event Listeners & Initial Render
// --------------------------------------------------

resetBoardBtn?.addEventListener("click", resetBoard);
undoMoveBtn?.addEventListener("click", undoMove);
redoMoveBtn?.addEventListener("click", redoMove);
flipBoardBtn?.addEventListener("click", flipBoard);
copyFenBtn?.addEventListener("click", copyFen);
askAiPosBtn?.addEventListener("click", askAiAboutCurrentPosition);

renderBoard();
updateGameInfo();
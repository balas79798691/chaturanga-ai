
const API_URL = "http://127.0.0.1:8000/ask";

const chatForm = document.getElementById("chatForm");
const questionInput = document.getElementById("questionInput");
const sendBtn = document.getElementById("sendBtn");
const messages = document.getElementById("messages");
const welcomeScreen = document.getElementById("welcomeScreen");
const newChatBtn = document.getElementById("newChatBtn");

let isLoading = false;
const SESSION_STORAGE_KEY = "chaturanga_session_id";

let sessionId = localStorage.getItem(SESSION_STORAGE_KEY);

if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
}

// --------------------------------------------------
// Add a message to the chat
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
    label.textContent = sender === "user"
        ? "YOU"
        : "CHATURANGA AI";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (sender === "assistant") {
        bubble.innerHTML = DOMPurify.sanitize(
        marked.parse(text)
    ); 
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
            `http://127.0.0.1:8000/history/${encodeURIComponent(sessionId)}`
        );

        if (!response.ok) {
            throw new Error("Failed to load conversation history");
        }

        const data = await response.json();

        if (data.messages && data.messages.length > 0) {
            welcomeScreen.style.display = "none";

            data.messages.forEach((message) => {
                const sender =
                    message.role === "user" ? "user" : "assistant";

                addMessage(message.content, sender);
            });
        }
    } catch (error) {
        console.error("History loading error:", error);
    }
}

loadConversationHistory();

// --------------------------------------------------
// Loading indicator
// --------------------------------------------------

function showTypingIndicator() {
    const indicator = document.createElement("div");
    indicator.className = "message";
    indicator.id = "typingIndicator";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "♞";

    const text = document.createElement("div");
    text.className = "typing";
    text.textContent = "Chaturanga AI is thinking...";

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
// Send a question to FastAPI
// --------------------------------------------------

async function sendQuestion(question) {
    question = question.trim();

    if (!question || isLoading) {
        return;
    }

    welcomeScreen.style.display = "none";

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
            throw new Error(
                `Server error: ${response.status}`
            );
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

// --------------------------------------------------
// Form submission
// --------------------------------------------------

chatForm.addEventListener("submit", function (event) {
    event.preventDefault();

    sendQuestion(questionInput.value);
});

// --------------------------------------------------
// Enter to send, Shift + Enter for a new line
// --------------------------------------------------

questionInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        chatForm.requestSubmit();
    }
});

// --------------------------------------------------
// Auto-resize the input box
// --------------------------------------------------

questionInput.addEventListener("input", function () {
    questionInput.style.height = "auto";

    questionInput.style.height =
        Math.min(questionInput.scrollHeight, 150) + "px";
});

// --------------------------------------------------
// Suggested questions
// --------------------------------------------------

document.querySelectorAll("[data-question]").forEach(button => {
    button.addEventListener("click", function () {
        const question = this.dataset.question;

        if (question) {
            sendQuestion(question);
        }
    });
});

// --------------------------------------------------
// New conversation
// --------------------------------------------------

newChatBtn.addEventListener("click", function () {
    if (isLoading) {
        return;
    }

    // Start a fresh conversation
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);

    messages.innerHTML = "";
    welcomeScreen.style.display = "block";
    questionInput.value = "";
    questionInput.focus();
});
// ===============================
// Interactive Chessboard
// ===============================

// ===============================
// Interactive Chessboard
// With Chess.js Rules
// ===============================

const chessboard = document.getElementById("chessboard");
const resetBoardBtn = document.getElementById("resetBoardBtn");
const undoMoveBtn = document.getElementById("undoMoveBtn");
const redoMoveBtn = document.getElementById("redoMoveBtn");
const redoStack = [];
const turnIndicator = document.getElementById("turnIndicator");
const moveHistory = document.getElementById("moveHistory");

const game = new Chess();

let selectedSquare = null;

const pieceSymbols = {
    w: {
        k: "♔",
        q: "♕",
        r: "♖",
        b: "♗",
        n: "♘",
        p: "♙"
    },
    b: {
        k: "♚",
        q: "♛",
        r: "♜",
        b: "♝",
        n: "♞",
        p: "♟"
    }
};

function renderBoard() {
    chessboard.innerHTML = "";

    const board = game.board();
    const legalMoves = selectedSquare
         ? game.moves({
            square: selectedSquare,
            verbose: true
        })
        : [];
    const legalTargets = legalMoves.map(move => move.to);

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement("div");

            square.classList.add("chess-square");

            const isLight = (row + col) % 2 === 0;
            square.classList.add(isLight ? "light" : "dark");

            const piece = board[row][col];

            if (piece) {
                square.textContent =
                    pieceSymbols[piece.color][piece.type];

                square.classList.add(
                    piece.color === "w"
                        ? "white-piece"
                        : "black-piece"
                );
            }

            const squareName =
                String.fromCharCode(97 + col) + (8 - row);

            square.dataset.square = squareName;

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
    // Update turn indicator
    if (game.in_checkmate()) {
        turnIndicator.textContent =
            `Checkmate! ${game.turn() === "w" ? "Black" : "White"} wins!`;
    } else if (game.in_draw()) {
        turnIndicator.textContent = "Game Over — Draw!";
    } else if (game.in_check()) {
        turnIndicator.textContent =
            `${game.turn() === "w" ? "White" : "Black"} is in Check!`;
    } else {
        turnIndicator.textContent =
            `${game.turn() === "w" ? "White" : "Black"}'s Turn`;
    }
    updateUndoRedoButtons();

    // Update move history
    const history = game.history();

    if (history.length === 0) {
        moveHistory.innerHTML =
            '<p class="empty-history">No moves yet</p>';
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
}
function handleSquareClick(squareName) {
    const piece = game.get(squareName);

    // Select a piece belonging to the current player
    if (selectedSquare === null) {
        if (piece && piece.color === game.turn()) {
            selectedSquare = squareName;
            renderBoard();
        }
        return;
    }

    // Deselect by clicking the same square
    if (selectedSquare === squareName) {
        selectedSquare = null;
        renderBoard();
        return;
    }

    // Attempt a legal move
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

        if (game.isCheckmate()) {
            alert("Checkmate! " +
                (game.turn() === "w" ? "Black" : "White") +
                " wins!");
        } else if (game.isDraw()) {
            alert("The game is a draw!");
        } else if (game.isCheck()) {
            alert("Check!");
        }

        return;
    }

    // If the destination is another piece of the current player,
    // select that piece instead
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

resetBoardBtn.addEventListener("click", resetBoard);
undoMoveBtn.addEventListener("click", undoMove);
redoMoveBtn.addEventListener("click", redoMove);

renderBoard();
updateGameInfo();
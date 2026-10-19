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

// Voice & Speech (STT & TTS) elements
const micBtn = document.getElementById("micBtn");
const speechBanner = document.getElementById("speechBanner");
const stopSpeechBannerBtn = document.getElementById("stopSpeechBannerBtn");

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

// --------------------------------------------------
// Voice Services: Speech-to-Text & Text-to-Speech
// --------------------------------------------------

// ==================================================
// 1. Text-to-Speech (TTS) Engine
// ==================================================

let activeTtsBtn = null;
let isSpeakingResponse = false;
let ttsHeartbeatInterval = null;
let availableVoices = [];

function loadVoices() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
            availableVoices = window.speechSynthesis.getVoices() || [];
        } catch (e) {
            availableVoices = [];
        }
    }
}

loadVoices();
if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
}

function cleanMarkdownForSpeech(markdown) {
    if (!markdown) return "";
    let text = markdown;

    // Remove code blocks
    text = text.replace(/```[\s\S]*?```/g, " ");
    // Remove inline code
    text = text.replace(/`([^`]+)`/g, "$1");
    // Remove image syntax
    text = text.replace(/!\[(.*?)\]\(.*?\)/g, "$1");
    // Remove links, keep text
    text = text.replace(/\[(.*?)\]\(.*?\)/g, "$1");
    // Remove headings
    text = text.replace(/^#{1,6}\s+/gm, "");
    // Remove blockquotes
    text = text.replace(/^\s*>\s+/gm, "");
    // Remove bold and italics
    text = text.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1");
    // Remove strikethrough
    text = text.replace(/~~(.*?)~~/g, "$1");
    // Clean chess move notation: e.g. "1. e4 e5 2. Nf3" -> "e4 e5, Nf3" so it doesn't pause on "1."
    text = text.replace(/\b\d+\.\s+/g, "");
    // Clean list markers
    text = text.replace(/^\s*[-*+]\s+/gm, "");
    // Remove horizontal rules
    text = text.replace(/^(?:[-*_]\s*){3,}$/gm, "");
    // Remove chess piece symbols
    text = text.replace(/[♟♞♝♜♛♚♙♘♗♖♕♔]/g, "");
    // Standardize spacing and pauses
    text = text.replace(/\n+/g, ". ");
    text = text.replace(/\s+/g, " ");
    text = text.replace(/(\.\s*)+/g, ". ");
    return text.trim();
}

function stopTextToSpeech() {
    if (ttsHeartbeatInterval) {
        clearInterval(ttsHeartbeatInterval);
        ttsHeartbeatInterval = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
            window.speechSynthesis.cancel();
        } catch (e) {}
    }
    window.__ttsUtterance = null;
    isSpeakingResponse = false;
    if (activeTtsBtn) {
        activeTtsBtn.classList.remove("playing");
        const label = activeTtsBtn.querySelector(".tts-label");
        if (label) label.textContent = "Listen";
        activeTtsBtn.setAttribute("aria-label", "Listen to response");
        activeTtsBtn.setAttribute("title", "Listen to response");
        activeTtsBtn = null;
    }
}

function toggleTextToSpeech(rawText, btn) {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
        showToast("Text-to-speech audio is not supported in this browser.", "danger");
        return;
    }

    // If currently playing on THIS button, stop it
    if (isSpeakingResponse && activeTtsBtn === btn) {
        stopTextToSpeech();
        showToast("Audio playback stopped");
        return;
    }

    // Stop any active speech recognition
    if (isRecognizingSpeech || isFallbackRecording) {
        stopSpeechRecognition();
    }

    // If already speaking another message, cancel it first
    const wasSpeaking = isSpeakingResponse || window.speechSynthesis.speaking;
    stopTextToSpeech();

    const cleanText = cleanMarkdownForSpeech(rawText);
    if (!cleanText) {
        showToast("No readable text found for audio playback.", "info");
        return;
    }

    isSpeakingResponse = true;
    activeTtsBtn = btn;
    btn.classList.add("playing");
    const label = btn.querySelector(".tts-label");
    if (label) label.textContent = "Stop";
    btn.setAttribute("aria-label", "Stop audio playback");
    btn.setAttribute("title", "Click to stop audio playback");

    // Short 50ms pause if another audio was just cancelled, preventing Chromium cancellation race condition
    const startDelay = wasSpeaking ? 60 : 0;

    setTimeout(() => {
        if (!isSpeakingResponse || activeTtsBtn !== btn) return;

        // Wake up speech synthesis audio thread if paused
        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
        }

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = "en-US";
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        if (availableVoices.length === 0) {
            loadVoices();
        }
        if (availableVoices.length > 0) {
            const preferred = availableVoices.find(v => 
                (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Samantha") || v.name.includes("Daniel") || v.name.includes("Karen") || v.name.includes("Premium")) && v.lang.startsWith("en")
            ) || availableVoices.find(v => v.lang.startsWith("en"));
            if (preferred) {
                utterance.voice = preferred;
            }
        }

        utterance.onstart = () => {
            // Heartbeat to prevent Chrome ~14s speech cutoff bug on long texts
            if (ttsHeartbeatInterval) clearInterval(ttsHeartbeatInterval);
            ttsHeartbeatInterval = setInterval(() => {
                if (window.speechSynthesis && window.speechSynthesis.speaking) {
                    window.speechSynthesis.pause();
                    window.speechSynthesis.resume();
                } else {
                    clearInterval(ttsHeartbeatInterval);
                }
            }, 8000);
        };

        utterance.onend = () => {
            stopTextToSpeech();
        };

        utterance.onerror = (e) => {
            if (e.error !== "interrupted" && e.error !== "canceled") {
                console.warn("Speech synthesis error:", e);
                showToast("Could not play response audio on this device.", "danger");
            }
            stopTextToSpeech();
        };

        // Pin to window to prevent V8 / WebKit garbage collection mid-speech
        window.__ttsUtterance = utterance;

        window.speechSynthesis.speak(utterance);
    }, startDelay);
}

// ==================================================
// 2. Speech-to-Text (STT) Engine
// Primary: Native SpeechRecognition (Chrome, Edge, Safari)
// Fallback: MediaRecorder + Backend Gemini Transcribe (Firefox & unsupported)
// ==================================================

const SpeechRecognitionClass = window.SpeechRecognition || 
                              window.webkitSpeechRecognition || 
                              window.mozSpeechRecognition || 
                              window.msSpeechRecognition;

const isSafariBrowser = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

let activeRecognition = null;
let isRecognizingSpeech = false;
let speechBaseText = "";
let speechRestartTimer = null;

// MediaRecorder Fallback state
let mediaRecorderInstance = null;
let recordedAudioChunks = [];
let mediaStreamRef = null;
let isFallbackRecording = false;

function updateMicUiActive(active, bannerText = "Listening... Speak your chess question") {
    if (micBtn) {
        micBtn.classList.toggle("recording", active);
        micBtn.setAttribute("aria-pressed", active ? "true" : "false");
        micBtn.setAttribute("title", active ? "Click to stop listening" : "Turn on microphone to speak");
    }
    if (speechBanner) {
        speechBanner.classList.toggle("active", active);
        const textEl = speechBanner.querySelector(".speech-banner-text");
        if (textEl) textEl.textContent = bannerText;
    }
    if (questionInput) {
        questionInput.placeholder = active 
            ? "🎙️ Listening... Speak your chess question now..." 
            : "Ask anything about chess, rules, or current position...";
    }
}

function stopSpeechRecognition() {
    if (speechRestartTimer) {
        clearTimeout(speechRestartTimer);
        speechRestartTimer = null;
    }

    // Stop Native Speech Recognition if active
    if (activeRecognition) {
        try {
            activeRecognition.abort();
        } catch (e) {}
        activeRecognition = null;
    }
    isRecognizingSpeech = false;

    // Stop MediaRecorder fallback if active
    if (mediaRecorderInstance && mediaRecorderInstance.state !== "inactive") {
        try {
            mediaRecorderInstance.stop();
        } catch (e) {}
    }
    if (mediaStreamRef) {
        try {
            mediaStreamRef.getTracks().forEach(track => track.stop());
        } catch (e) {}
        mediaStreamRef = null;
    }
    isFallbackRecording = false;

    updateMicUiActive(false);
}

function startNativeSpeechRecognition() {
    try {
        const recognition = new SpeechRecognitionClass();
        activeRecognition = recognition;

        // Safari does not support continuous mode; Chrome/Edge do
        recognition.continuous = !isSafariBrowser;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onstart = () => {
            isRecognizingSpeech = true;
            updateMicUiActive(true, "Listening... Speak your chess question");
            showToast("Microphone is active. Speak your question...", "info");
        };

        recognition.onresult = (event) => {
            let interimTranscript = "";
            let finalTranscript = "";

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const part = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += part + " ";
                } else {
                    interimTranscript += part;
                }
            }

            const spoken = (finalTranscript + interimTranscript).trim();
            let combined = speechBaseText;
            if (combined && !combined.endsWith(" ")) {
                combined += " ";
            }
            combined += spoken;

            questionInput.value = combined;
            questionInput.style.height = "auto";
            questionInput.style.height = Math.min(questionInput.scrollHeight, 140) + "px";
        };

        recognition.onerror = (event) => {
            console.warn("Speech recognition error:", event.error);
            if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                showToast("Microphone access was denied. Please allow microphone permissions in your browser.", "danger");
                stopSpeechRecognition();
            } else if (event.error === "audio-capture") {
                showToast("No microphone was detected. Please check your audio input device.", "danger");
                stopSpeechRecognition();
            } else if (event.error === "network") {
                console.log("Native speech network error; falling back to MediaRecorder...");
                stopSpeechRecognition();
                startMediaRecorderFallback();
            } else if (event.error !== "no-speech" && event.error !== "aborted") {
                stopSpeechRecognition();
            }
        };

        recognition.onend = () => {
            // If user did not manually stop (e.g. Safari single phrase ended), auto-restart smoothly
            if (isRecognizingSpeech && activeRecognition === recognition) {
                speechBaseText = questionInput.value.trim();
                activeRecognition = null;
                speechRestartTimer = setTimeout(() => {
                    if (isRecognizingSpeech) {
                        startNativeSpeechRecognition();
                    }
                }, 100);
            } else {
                activeRecognition = null;
                isRecognizingSpeech = false;
                updateMicUiActive(false);
            }
        };

        recognition.start();

    } catch (err) {
        console.warn("Failed to start native speech recognition, falling back to MediaRecorder:", err);
        startMediaRecorderFallback();
    }
}

async function startMediaRecorderFallback() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast("Audio recording is not supported in this browser. Please use Chrome, Edge, or Safari.", "danger");
        stopSpeechRecognition();
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef = stream;
        recordedAudioChunks = [];

        let options = {};
        if (typeof MediaRecorder.isTypeSupported === "function") {
            if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
                options = { mimeType: "audio/webm;codecs=opus" };
            } else if (MediaRecorder.isTypeSupported("audio/webm")) {
                options = { mimeType: "audio/webm" };
            } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
                options = { mimeType: "audio/mp4" };
            }
        }

        const recorder = new MediaRecorder(stream, options);
        mediaRecorderInstance = recorder;

        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                recordedAudioChunks.push(e.data);
            }
        };

        recorder.onstart = () => {
            isFallbackRecording = true;
            updateMicUiActive(true, "Recording voice... Click Stop when finished");
            showToast("Recording voice... Click Stop when finished", "info");
        };

        recorder.onstop = async () => {
            isFallbackRecording = false;
            updateMicUiActive(false);

            if (recordedAudioChunks.length === 0) return;

            const mime = recorder.mimeType || "audio/webm";
            const audioBlob = new Blob(recordedAudioChunks, { type: mime });
            recordedAudioChunks = [];

            // Transcribe using backend Gemini endpoint
            showToast("Transcribing your audio with AI...", "info");

            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Data = reader.result;
                try {
                    const response = await fetch(`${API_BASE}/api/transcribe`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            audio_base64: base64Data,
                            mime_type: mime
                        })
                    });

                    if (!response.ok) throw new Error("Transcription server error");

                    const data = await response.json();
                    if (data.text) {
                        let combined = speechBaseText;
                        if (combined && !combined.endsWith(" ")) combined += " ";
                        combined += data.text;
                        questionInput.value = combined;
                        questionInput.style.height = "auto";
                        questionInput.style.height = Math.min(questionInput.scrollHeight, 140) + "px";
                        showToast("Voice transcribed successfully!");
                        questionInput.focus();
                    } else if (data.error) {
                        console.error("Transcribe API error:", data.error);
                        showToast("Could not transcribe voice. Try typing your question.", "danger");
                    }
                } catch (err) {
                    console.error("Transcription failed:", err);
                    showToast("Could not transcribe voice. Please try again or type.", "danger");
                }
            };
            reader.readAsDataURL(audioBlob);
        };

        recorder.start();

    } catch (err) {
        console.error("getUserMedia error:", err);
        showToast("Microphone access denied. Please allow microphone permissions in your browser.", "danger");
        stopSpeechRecognition();
    }
}

function toggleSpeechRecognition(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }

    if (isRecognizingSpeech || isFallbackRecording) {
        stopSpeechRecognition();
        showToast("Voice input stopped");
        return;
    }

    // Stop TTS if speaking so mic doesn't record the response
    if (isSpeakingResponse) {
        stopTextToSpeech();
    }

    speechBaseText = questionInput.value.trim();

    if (SpeechRecognitionClass) {
        startNativeSpeechRecognition();
    } else {
        startMediaRecorderFallback();
    }
}

micBtn?.addEventListener("click", toggleSpeechRecognition);
stopSpeechBannerBtn?.addEventListener("click", (e) => {
    if (e) e.preventDefault();
    stopSpeechRecognition();
    showToast("Voice input stopped");
});

async function switchToSession(targetSessionId) {
    if (isLoading) return;
    if (targetSessionId === sessionId) {
        setActiveMobileView("chat");
        sidebar?.classList.remove("open");
        return;
    }

    stopTextToSpeech();
    stopSpeechRecognition();

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

    stopTextToSpeech();
    stopSpeechRecognition();

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

    // Assistant response action bar: Text-to-Speech (Speaker) & Copy
    if (sender === "assistant" && !isError) {
        const actionsBar = document.createElement("div");
        actionsBar.className = "message-actions";

        // TTS Speaker button
        const ttsBtn = document.createElement("button");
        ttsBtn.type = "button";
        ttsBtn.className = "message-action-btn tts-btn";
        ttsBtn.setAttribute("title", "Listen to response");
        ttsBtn.setAttribute("aria-label", "Listen to response");

        ttsBtn.innerHTML = `
            <svg class="tts-icon-default" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
            </svg>
            <svg class="tts-icon-stop" viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2"></rect>
            </svg>
            <span class="tts-label">Listen</span>
            <div class="tts-wave">
                <span></span><span></span><span></span>
            </div>
        `;

        ttsBtn.addEventListener("click", () => {
            toggleTextToSpeech(text, ttsBtn);
        });

        // Copy button
        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "message-action-btn copy-btn";
        copyBtn.setAttribute("title", "Copy response");
        copyBtn.setAttribute("aria-label", "Copy response");

        copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span class="copy-label">Copy</span>
        `;

        copyBtn.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(text);
                const copyLabel = copyBtn.querySelector(".copy-label");
                if (copyLabel) copyLabel.textContent = "Copied!";
                setTimeout(() => {
                    if (copyLabel) copyLabel.textContent = "Copy";
                }, 1600);
            } catch (err) {
                console.error("Copy failed", err);
            }
        });

        actionsBar.appendChild(ttsBtn);
        actionsBar.appendChild(copyBtn);
        content.appendChild(actionsBar);
    }

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

    if (isRecognizingSpeech) {
        stopSpeechRecognition();
    }
    stopTextToSpeech();

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
    if (isRecognizingSpeech) {
        speechBaseText = questionInput.value.trim();
    }
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
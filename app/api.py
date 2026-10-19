
import base64
import functools
import io
import re
import sqlite3
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from google import genai
from gtts import gTTS
from pydantic import BaseModel

from app.rag import ask_question, get_gemini_client

# --------------------------------------------------
# 1. Configuration
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "conversations.db"

app = FastAPI()

# Cache-control middleware to prevent browser and CDN caching of frontend files
@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.endswith((".html", ".css", ".js")) or path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------
# 2. Database setup
# --------------------------------------------------

def get_connection():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def init_database():
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_session
            ON messages(session_id, id)
        """)


init_database()

# --------------------------------------------------
# 3. Request model
# --------------------------------------------------

class QuestionRequest(BaseModel):
    question: str
    session_id: str


class TranscribeRequest(BaseModel):
    audio_base64: str
    mime_type: str = "audio/webm"


class SpeakRequest(BaseModel):
    text: str


def clean_text_for_speech(text: str) -> str:
    if not text:
        return ""
    # Strip markdown code blocks
    text = re.sub(r"```[\s\S]*?```", " ", text)
    # Strip inline code
    text = re.sub(r"`[^`]+`", " ", text)
    # Strip links, retain anchor text
    text = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", text)
    # Strip markdown headings
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    # Strip bold/italics
    text = re.sub(r"[*_]{1,3}([^*_]+)[*_]{1,3}", r"\1", text)
    # Clean move numbers so it reads like commentary: e.g. 1. e4 e5 -> e4 e5
    text = re.sub(r"\b\d+\.\s*", "", text)
    # Strip list bullets
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    # Strip chess pieces
    text = re.sub(r"[♟♞♝♜♛♚♙♘♗♖♕♔]", "", text)
    # Collapse periods and spacing
    text = re.sub(r"\n+", ". ", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"(\.\s*)+", ". ", text)
    return text.strip()

# --------------------------------------------------
# 4. Routes
# --------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok", "message": "Chess RAG Chatbot API is running!"}


@functools.lru_cache(maxsize=128)
def get_tts_audio_data(clean_text: str) -> bytes:
    """Generate and cache MP3 audio bytes using gTTS."""
    buf = io.BytesIO()
    tts = gTTS(text=clean_text, lang="en")
    tts.write_to_fp(buf)
    return buf.getvalue()


@app.post("/api/speak")
def speak(request: SpeakRequest):
    """Generate high-quality MP3 speech audio via Google TTS for reliable universal playback on any device."""
    try:
        clean_text = clean_text_for_speech(request.text)
        if not clean_text:
            return Response(content=b"", media_type="audio/mpeg", status_code=400)

        # Cap length to prevent unbounded generation
        if len(clean_text) > 1500:
            clean_text = clean_text[:1500].rsplit(".", 1)[0] + "."

        audio_data = get_tts_audio_data(clean_text)

        return Response(
            content=audio_data,
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "public, max-age=86400",
                "Accept-Ranges": "bytes",
            },
        )
    except Exception as e:
        print(f"TTS generation error: {e}")
        return Response(content=str(e).encode(), media_type="text/plain", status_code=500)


@app.get("/api/speak")
def speak_get(text: str = ""):
    """GET variant of /api/speak for direct audio streaming src playback."""
    try:
        clean_text = clean_text_for_speech(text)
        if not clean_text:
            return Response(content=b"", media_type="audio/mpeg", status_code=400)

        if len(clean_text) > 1500:
            clean_text = clean_text[:1500].rsplit(".", 1)[0] + "."

        audio_data = get_tts_audio_data(clean_text)

        return Response(
            content=audio_data,
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "public, max-age=86400",
                "Accept-Ranges": "bytes",
            },
        )
    except Exception as e:
        print(f"TTS generation error: {e}")
        return Response(content=str(e).encode(), media_type="text/plain", status_code=500)


@app.post("/api/transcribe")
def transcribe(request: TranscribeRequest):
    """Fallback audio transcription endpoint using Gemini Flash when client speech recognition is unsupported or fails."""
    try:
        raw_b64 = request.audio_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]

        audio_bytes = base64.b64decode(raw_b64)
        if not audio_bytes:
            return {"text": "", "error": "Empty audio data received."}

        client = get_gemini_client()
        mime = request.mime_type.split(";")[0].strip() or "audio/webm"

        # Try active models with fallback
        response = None
        for model_name in ["gemini-3.5-flash-lite", "gemini-3.8-flash"]:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=[
                        genai.types.Part.from_bytes(data=audio_bytes, mime_type=mime),
                        "Transcribe this spoken chess question or query into text accurately. Output only the plain transcription text, nothing else. If there is no speech, output nothing."
                    ],
                )
                if response:
                    break
            except Exception as model_err:
                print(f"Transcription model {model_name} error: {model_err}")
                continue

        if not response:
            return {"text": "", "error": "Transcription models unavailable."}

        # Safely extract text parts without triggering thought_signature warnings
        text_parts = []
        if response.candidates and response.candidates[0].content and response.candidates[0].content.parts:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "text") and part.text:
                    text_parts.append(part.text)

        transcript = "".join(text_parts).strip() or (response.text or "").strip()
        return {"text": transcript}

    except Exception as e:
        print(f"Transcription error: {e}")
        return {"text": "", "error": str(e)}


@app.post("/ask")
def ask(request: QuestionRequest):
    session_id = request.session_id

    # Retrieve recent conversation history
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT role, content
            FROM messages
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT 10
            """,
            (session_id,),
        ).fetchall()

    # Restore chronological order
    history = list(reversed(rows))

    history_text = "\n".join(
        f"{message['role']}: {message['content']}"
        for message in history
    )

    # Generate the answer using the existing RAG pipeline
    answer = ask_question(
        question=request.question,
        history=history_text,
    )

    # Save both messages permanently
    with get_connection() as conn:
        conn.executemany(
        """
        INSERT INTO messages (session_id, role, content)
        VALUES (?, ?, ?)
        """,
        [
            (session_id, "user", request.question),
            (session_id, "assistant", answer),
        ],
    )

    return {
        "question": request.question,
        "answer": answer,
        "session_id": session_id,
    }


@app.get("/history/{session_id}")
def get_history(session_id: str):
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT role, content, created_at
            FROM messages
            WHERE session_id = ?
            ORDER BY id ASC
            """,
            (session_id,),
        ).fetchall()

    return {
        "session_id": session_id,
        "messages": [dict(row) for row in rows],
    }


def format_session_title(first_question: str) -> str:
    if not first_question:
        return "New Chess Chat"
    first_line = first_question.strip().split("\n")[0].strip()
    first_line_lower = first_line.lower()
    if "current chess position" in first_line_lower or "fen:" in first_question.lower():
        return "Position Analysis"
    if len(first_line) > 34:
        return first_line[:31] + "..."
    return first_line


@app.get("/sessions")
def get_sessions():
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT 
                m.session_id,
                (
                    SELECT content 
                    FROM messages 
                    WHERE session_id = m.session_id AND role = 'user' 
                    ORDER BY id ASC 
                    LIMIT 1
                ) AS first_question,
                MAX(m.created_at) AS last_active,
                COUNT(m.id) AS message_count
            FROM messages m
            GROUP BY m.session_id
            ORDER BY last_active DESC
            """
        ).fetchall()

    sessions = []
    for row in rows:
        title = format_session_title(row["first_question"])
        sessions.append({
            "session_id": row["session_id"],
            "title": title,
            "last_active": row["last_active"],
            "message_count": row["message_count"],
        })

    return {"sessions": sessions}


@app.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    with get_connection() as conn:
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
    return {"status": "deleted", "session_id": session_id}


# --------------------------------------------------
# 5. Serve Frontend (Unified Full-Stack Deployment)
# --------------------------------------------------

FRONTEND_DIR = BASE_DIR / "frontend"
if FRONTEND_DIR.exists():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
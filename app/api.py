
import sqlite3
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.rag import ask_question

# --------------------------------------------------
# 1. Configuration
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "conversations.db"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:8080",
        "http://localhost:8080",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
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

# --------------------------------------------------
# 4. Routes
# --------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok", "message": "Chess RAG Chatbot API is running!"}


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
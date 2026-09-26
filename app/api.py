
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
    ],
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

@app.get("/")
def home():
    return {"message": "Chess RAG Chatbot API is running!"}


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
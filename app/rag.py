
import os
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from qdrant_client import QdrantClient

# --------------------------------------------------
# 1. Configuration
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")

EMBEDDING_MODEL_NAME = "gemini-embedding-001"
COLLECTION_NAME = "chess_knowledge_gemini_v1"
VECTOR_SIZE = 768
SIMILARITY_THRESHOLD = 0.35
TOP_K = 3

QDRANT_PATH = str(BASE_DIR / "qdrant_storage")

# --------------------------------------------------
# 2. Gemini client and vector database setup
# --------------------------------------------------

def get_gemini_client():
    """Retrieve Gemini client using the environment API key."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is missing from your .env file or environment.")
    return genai.Client(api_key=api_key)


def ensure_collection_exists():
    """Ensure the Qdrant collection exists and has points; if missing or empty, ingest it automatically."""
    temp_client = QdrantClient(path=QDRANT_PATH)
    exists = temp_client.collection_exists(COLLECTION_NAME)
    has_points = False
    if exists:
        try:
            info = temp_client.get_collection(COLLECTION_NAME)
            has_points = (info.points_count or 0) > 0
        except Exception:
            has_points = False
    temp_client.close()

    if not exists or not has_points:
        print(f"Collection '{COLLECTION_NAME}' not found or empty in Qdrant. Running initial ingestion...")
        from app.ingest import ingest_documents
        ingest_documents()


ensure_collection_exists()

print("Connecting to Qdrant...")
qdrant_client = QdrantClient(path=QDRANT_PATH)

# --------------------------------------------------
# 3. Semantic search
# --------------------------------------------------


def search_qdrant(question, top_k=TOP_K):
    """Search Qdrant using Gemini embeddings and print similarity scores."""

    client = get_gemini_client()
    embed_response = client.models.embed_content(
        model=EMBEDDING_MODEL_NAME,
        contents=question,
        config={"output_dimensionality": VECTOR_SIZE},
    )
    query_embedding = embed_response.embeddings[0].values

    results = qdrant_client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_embedding,
        limit=top_k,
        with_payload=True,
    )

    print("\n--- DEBUG: Search Results ---")

    for point in results.points:
        print(f"Score: {point.score:.4f}")
        print(f"Text: {point.payload.get('text', '')[:200]}")
        print("-----------------------------")

    filtered_results = [
        point
        for point in results.points
        if point.score >= SIMILARITY_THRESHOLD
    ]

    print(f"Results after filtering: {len(filtered_results)}")

    return filtered_results
# --------------------------------------------------
# 4. Rewrite follow-up questions & positions
# --------------------------------------------------

def rewrite_query(question, history=""):
    """Rewrite a follow-up question or chess position into a standalone search query."""

    is_position_query = "fen:" in question.lower() or "moves played:" in question.lower()
    if not history and not is_position_query:
        return question

    client = get_gemini_client()

    prompt = f"""
You are a query rewriting assistant for a chess knowledge chatbot.

Your task is to convert the user's question into an effective semantic search query for a chess knowledge base.

RULES:
- If conversation history is provided, resolve references such as "it", "that", "why", and "give me an example".
- If the question contains a chess position, moves, or FEN notation (e.g. "Moves played: 1. e4", "Black to move"), extract the core chess opening, key moves, and strategic concepts (e.g. "1. e4 opening principles strategic plans and black responses").
- Preserve the original meaning and intent.
- Do not answer the question.
- Return ONLY the rewritten search query.
- Do not add explanations or quotation marks.

CONVERSATION HISTORY:
{history}

CURRENT QUESTION:
{question}

REWRITTEN SEARCH QUERY:
"""

    response = client.models.generate_content(
        model="gemini-3.5-flash-lite",
        contents=prompt,
    )

    rewritten = (response.text or "").strip()

    return rewritten or question

# --------------------------------------------------
# 5. Generate answer using Gemini
# --------------------------------------------------


def generate_answer(question, context, history=""):
    """Generate an answer using retrieved context, position analysis, and conversation history."""

    client = get_gemini_client()

    is_position_query = "fen:" in question.lower() or "moves played:" in question.lower()

    if is_position_query:
        prompt = f"""
You are Chaturanga AI, an insightful grandmaster-level chess assistant.

The user is asking for analysis of their current chessboard position.

Use the retrieved chess knowledge below to ground your explanation in sound principles and opening theory.
Also analyze the specific board position (FEN, move history, turn) directly using your deep chess understanding.

CONVERSATION HISTORY:
{history}

RETRIEVED KNOWLEDGE CONTEXT:
{context}

CURRENT CHESS POSITION & QUESTION:
{question}

INSTRUCTIONS:
- Break down the strategic ideas for both sides (center control, piece activity, king safety).
- Recommend 2-3 of the best candidate moves for the side to move with clear strategic reasoning.
- Format your response cleanly with markdown headings and bullet points.
- Be encouraging and educational.

ANSWER:
"""
    else:
        prompt = f"""
You are Chaturanga AI, a helpful chess knowledge assistant.

Use the conversation history to understand follow-up questions
and references such as "it", "that move", or "when can I do it".

Answer using the retrieved chess knowledge context below.
If the question is about chess and can be explained using standard chess principles, provide a clear, accurate explanation.
If the question is completely unrelated to chess or impossible to answer, state that the information is not available in the knowledge base.

CONVERSATION HISTORY:
{history}

RETRIEVED CONTEXT:
{context}

CURRENT QUESTION:
{question}

ANSWER:
"""

    response = client.models.generate_content(
        model="gemini-3.5-flash-lite",
        contents=prompt,
    )

    return response.text

# --------------------------------------------------
# 5. Complete RAG pipeline
# --------------------------------------------------


# --------------------------------------------------
# 6. Complete RAG pipeline with query rewriting
# --------------------------------------------------

def ask_question(question, history=""):
    """Rewrite the query, retrieve context, and generate an answer."""

    # Step 1: Rewrite the question for better retrieval
    search_query = rewrite_query(question, history)

    print("\n--- DEBUG: Query Rewriting ---")
    print(f"Original question: {question}")
    print(f"Rewritten query: {search_query}")
    print("-----------------------------")

    # Step 2: Search Qdrant using the rewritten query
    results = search_qdrant(search_query)

    if not results:
        return (
            "The information is not available in the "
            "knowledge base."
        )

    # Step 3: Build retrieved context
    context = "\n\n".join(
        result.payload["text"]
        for result in results
        if result.payload and result.payload.get("text")
    )

    if not context:
        return (
            "The information is not available in the "
            "knowledge base."
        )

    # Step 4: Generate an answer using the original question
    # and conversation history
    answer = generate_answer(
        question=question,
        context=context,
        history=history,
    )

    return answer
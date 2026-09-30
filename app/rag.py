
import os
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient

# --------------------------------------------------
# 1. Configuration
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")

MODEL_NAME = "all-MiniLM-L6-v2"
COLLECTION_NAME = "chess_knowledge_v4"
SIMILARITY_THRESHOLD = 0.4
TOP_K = 3

QDRANT_PATH = str(BASE_DIR / "qdrant_storage")

# --------------------------------------------------
# 2. Load models and database once
# --------------------------------------------------

print("Loading embedding model...")
embedding_model = SentenceTransformer(MODEL_NAME)


def ensure_collection_exists():
    """Ensure the Qdrant collection exists; if missing (e.g. on fresh deployment), ingest it automatically."""
    temp_client = QdrantClient(path=QDRANT_PATH)
    exists = temp_client.collection_exists(COLLECTION_NAME)
    temp_client.close()

    if not exists:
        print(f"Collection '{COLLECTION_NAME}' not found in Qdrant. Running initial ingestion...")
        from app.ingest import ingest_documents
        ingest_documents()


ensure_collection_exists()

print("Connecting to Qdrant...")
qdrant_client = QdrantClient(path=QDRANT_PATH)

# --------------------------------------------------
# 3. Semantic search
# --------------------------------------------------


def search_qdrant(question, top_k=TOP_K):
    """Search Qdrant and print similarity scores."""

    query_embedding = embedding_model.encode(question).tolist()

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
# 4. Rewrite follow-up questions
# --------------------------------------------------

def rewrite_query(question, history=""):
    """Rewrite a follow-up question into a standalone search query."""

    if not history:
        return question

    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise ValueError("GEMINI_API_KEY is missing from your .env file.")

    client = genai.Client(api_key=api_key)

    prompt = f"""
You are a query rewriting assistant for a chess knowledge chatbot.

Your task is to rewrite the current question into a standalone
search query that can be used to retrieve relevant chess knowledge.

RULES:
- Use the conversation history to understand references such as
  "it", "that", "why", and "give me an example".
- Preserve the original meaning and intent.
- If the question is already standalone, keep it unchanged.
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
# 4. Generate answer using Gemini
# --------------------------------------------------


def generate_answer(question, context, history=""):
    """Generate an answer using retrieved context and conversation history."""

    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise ValueError(
            "GEMINI_API_KEY is missing from your .env file."
        )

    client = genai.Client(api_key=api_key)

    prompt = f"""
You are a helpful chess knowledge assistant.

Use the conversation history to understand follow-up questions
and references such as "it", "that move", or "when can I do it".

Answer using ONLY the information provided in the retrieved
context below.

If the answer cannot be found in the context,
say that the information is not available in the knowledge base.

Do not invent or assume information.

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
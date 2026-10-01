import re
import os
from uuid import uuid4

import time

from dotenv import load_dotenv
from google import genai
from qdrant_client import QdrantClient, models

# Load environment variables
load_dotenv()

# Configuration
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATA_FILE = os.path.join(BASE_DIR, "data", "chess-knowledge.txt")
QDRANT_PATH = os.path.join(BASE_DIR, "qdrant_storage")

COLLECTION_NAME = "chess_knowledge_gemini_v1"
MODEL_NAME = "gemini-embedding-001"
VECTOR_SIZE = 768

CHUNK_SIZE = 500
CHUNK_OVERLAP = 100


def load_documents():
    """Load chess knowledge from the text file."""
    with open(DATA_FILE, "r", encoding="utf-8") as file:
        return file.read()


def chunk_text(text):
    """Split text into chunks while preserving heading hierarchy."""

    heading_pattern = re.compile(
        r"^(#{1,3}\s+.+|[A-Z][A-Z0-9 _—-]{3,})$",
        re.MULTILINE
    )

    matches = list(heading_pattern.finditer(text))
    sections = []
    heading_stack = []

    for i, match in enumerate(matches):
        heading = match.group().strip()
        start = match.start()
        end = (
            matches[i + 1].start()
            if i + 1 < len(matches)
            else len(text)
        )

        body = text[match.end():end].strip()

        if heading.startswith("#"):
            level = len(heading) - len(heading.lstrip("#"))
        else:
            level = 1

        while heading_stack and heading_stack[-1][0] >= level:
            heading_stack.pop()

        heading_stack.append((level, heading))

        context = "\n".join(
            item[1] for item in heading_stack
        )

        sections.append((context, body))

    chunks = []

    for context, body in sections:
        prefix = f"{context}\n\n"
        max_body_size = CHUNK_SIZE - len(prefix)

        if max_body_size <= 0:
            continue

        paragraphs = [
            p.strip()
            for p in body.split("\n\n")
            if p.strip()
        ]

        current_chunk = ""

        for paragraph in paragraphs:
            candidate = (
                f"{current_chunk}\n\n{paragraph}"
                if current_chunk else paragraph
            )

            if len(candidate) <= max_body_size:
                current_chunk = candidate
            else:
                if current_chunk:
                    chunks.append(prefix + current_chunk)

                if len(paragraph) > max_body_size:
                    start = 0

                    while start < len(paragraph):
                        end = start + max_body_size
                        chunk = paragraph[start:end].strip()

                        if chunk:
                            chunks.append(prefix + chunk)

                        start += max_body_size - CHUNK_OVERLAP

                    current_chunk = ""
                else:
                    current_chunk = paragraph

        if current_chunk:
            chunks.append(prefix + current_chunk)

    return chunks
def ingest_documents():
    """Generate embeddings using Gemini text-embedding-004 and store them in Qdrant."""

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("Warning: GEMINI_API_KEY is not set. Ingestion cannot proceed without API key.")
        return

    print("Loading chess knowledge...")
    text = load_documents()

    chunks = chunk_text(text)
    print(f"Total chunks: {len(chunks)}")

    print(f"Generating embeddings with Gemini ({MODEL_NAME})...")
    client_genai = genai.Client(api_key=api_key)

    # Batch embeddings to respect API limits (50 chunks per batch)
    batch_size = 50
    all_embeddings = []

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i : i + batch_size]
        batch_num = i // batch_size + 1
        total_batches = (len(chunks) + batch_size - 1) // batch_size
        print(f"Embedding batch {batch_num}/{total_batches}...")

        max_retries = 5
        for attempt in range(max_retries):
            try:
                response = client_genai.models.embed_content(
                    model=MODEL_NAME,
                    contents=batch,
                    config={"output_dimensionality": VECTOR_SIZE},
                )
                for item in response.embeddings:
                    all_embeddings.append(item.values)
                break
            except Exception as e:
                if ("429" in str(e) or "RESOURCE_EXHAUSTED" in str(e)) and attempt < max_retries - 1:
                    wait_time = 35
                    print(f"Rate limit reached (Free tier 100/min). Waiting {wait_time}s before retrying batch {batch_num}...")
                    time.sleep(wait_time)
                else:
                    raise e

        if i + batch_size < len(chunks):
            time.sleep(1)

    print("Connecting to Qdrant...")
    client = QdrantClient(path=QDRANT_PATH)

    if not client.collection_exists(COLLECTION_NAME):
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=models.VectorParams(
                size=VECTOR_SIZE,
                distance=models.Distance.COSINE,
            ),
        )

    points = []
    for chunk, embedding in zip(chunks, all_embeddings):
        points.append(
            models.PointStruct(
                id=str(uuid4()),
                vector=embedding,
                payload={"text": chunk},
            )
        )

    client.upsert(
        collection_name=COLLECTION_NAME,
        points=points,
    )

    client.close()

    print("Ingestion completed successfully!")
    print(f"Stored {len(points)} chunks in Qdrant collection '{COLLECTION_NAME}'.")


if __name__ == "__main__":
    ingest_documents()
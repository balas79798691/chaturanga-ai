import re
import os
from uuid import uuid4

from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient, models

# Load environment variables
load_dotenv()

# Configuration
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATA_FILE = os.path.join(BASE_DIR, "data", "chess-knowledge.txt")
QDRANT_PATH = os.path.join(BASE_DIR, "qdrant_storage")

COLLECTION_NAME = "chess_knowledge_v4"
MODEL_NAME = "all-MiniLM-L6-v2"



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
    """Generate embeddings and store them in Qdrant."""

    print("Loading chess knowledge...")
    text = load_documents()

    chunks = chunk_text(text)
    print(f"Total chunks: {len(chunks)}")

    print("Loading embedding model...")
    model = SentenceTransformer(MODEL_NAME)

    print("Generating embeddings...")
    embeddings = model.encode(
        chunks,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )

    print("Connecting to Qdrant...")
    client = QdrantClient(path=QDRANT_PATH)

    if not client.collection_exists(COLLECTION_NAME):
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=models.VectorParams(
                size=384,
                distance=models.Distance.COSINE,
            ),
        )

    points = []

    for chunk, embedding in zip(chunks, embeddings):
        points.append(
            models.PointStruct(
                id=str(uuid4()),
                vector=embedding.tolist(),
                payload={"text": chunk},
            )
        )

    client.upsert(
        collection_name=COLLECTION_NAME,
        points=points,
    )

    client.close()

    print("Ingestion completed successfully!")
    print(f"Stored {len(points)} chunks in Qdrant.")


if __name__ == "__main__":
    ingest_documents()
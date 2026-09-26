
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

COLLECTION_NAME = "chess_knowledge"
MODEL_NAME = "all-MiniLM-L6-v2"

CHUNK_SIZE = 500
CHUNK_OVERLAP = 100


def load_documents():
    """Load chess knowledge from the text file."""
    with open(DATA_FILE, "r", encoding="utf-8") as file:
        return file.read()


def chunk_text(text):
    """Split text into overlapping chunks."""
    chunks = []
    start = 0

    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        start += CHUNK_SIZE - CHUNK_OVERLAP

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
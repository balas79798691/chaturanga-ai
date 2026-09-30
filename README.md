# ♟️ Chaturanga AI

**Chaturanga AI** is an intelligent, full-stack Chess Assistant featuring a **Retrieval-Augmented Generation (RAG)** pipeline powered by **Google Gemini**, **Qdrant**, and **FastAPI**, paired with an **Interactive Chessboard** and persistent conversation history.

---

## 🌟 Key Features

- **Interactive Chessboard**: Play moves on a real chessboard powered by `chess.js`, complete with legal move highlights, capture indicators, turn & check detection, board flip (White/Black), and algebraic coordinates.
- **💡 "Ask AI About This Position"**: Instantly sends the current board position (FEN, move history, turn, and check status) to the AI for tactical advice and strategic analysis.
- **Chat History (ChatGPT / Claude style)**: Persistent conversations stored in SQLite, accessible from the sidebar. Easily switch between past sessions, start new ones, or delete old ones.
- **Heading-Aware RAG Pipeline**: Ingests chess knowledge while preserving document hierarchy and context, delivering grounded, hallucination-free explanations.
- **Query Rewriting**: Resolves follow-up pronouns (e.g., *"how do I defend against it?"*) into standalone search queries before semantic retrieval.
- **Unified Full-Stack Architecture**: FastAPI serves both the REST API and the responsive web frontend under a single port without CORS friction.

---

## 🚀 One-Click Deployment (Render / Railway)

### Option A: Deploy on [Render](https://render.com) (Recommended Free Tier)

1. Push your latest code to your **GitHub repository**:
   ```bash
   git add .
   git commit -m "Prepare for deployment"
   git push origin main
   ```
2. Go to **[dashboard.render.com](https://dashboard.render.com)** and click **New +** → **Web Service**.
3. Connect your GitHub repository.
4. Render will automatically detect the settings from `render.yaml`, or you can enter them manually:
   - **Environment**: `Python`
   - **Build Command**: `pip install -r requirements.txt && python app/ingest.py`
   - **Start Command**: `uvicorn app.api:app --host 0.0.0.0 --port $PORT`
5. Under **Environment Variables**, add:
   - `GEMINI_API_KEY`: *Your Google Gemini API Key*
   - `PYTHON_VERSION`: `3.10.12`
6. Click **Deploy Web Service**! Once finished, Render gives you a live public URL (e.g. `https://chaturanga-ai.onrender.com`).

---

### Option B: Deploy on [Railway](https://railway.app)

1. Push your code to GitHub.
2. Go to **[railway.app](https://railway.app)** and click **New Project** → **Deploy from GitHub repo**.
3. Select your repository. Railway will detect the included `Dockerfile` or `Procfile`.
4. In the project **Variables** tab, add:
   - `GEMINI_API_KEY`: *Your Google Gemini API Key*
5. Click **Deploy**. In the **Settings** tab, generate a public domain to access your app.

---

## 💻 Local Development

### 1. Prerequisites
- Python 3.9+
- A Google Gemini API Key ([Google AI Studio](https://aistudio.google.com/))

### 2. Setup
```bash
# Clone the repository
git clone https://github.com/balas79798691/chaturanga-ai.git
cd chaturanga-ai

# Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create your .env file
echo "GEMINI_API_KEY=your_gemini_api_key_here" > .env
```

### 3. Run the Unified Server
```bash
# Run the FastAPI server (serves both frontend and backend)
uvicorn app.api:app --reload --port 8000
```
Open **[http://localhost:8000](http://localhost:8000)** in your browser!

*(Alternatively, you can run `python3 -m http.server 5500 --directory frontend` to serve the frontend on port 5500 during standalone frontend work).*

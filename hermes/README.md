# Hermes - Second Brain Core Engine

**Hermes** (named after the messenger of the gods) is the intelligence layer and orchestrator of your Second Brain.

---

## ⚡ Core Capabilities

1. **Information Ingestion & Normalization**:
   - Consumes normalized documents from `crawlers/`.
   - Cleans, parses, and enriches documents.

2. **Vector Embeddings & Semantic Search**:
   - Generates vector representations of personal notes, articles, and logs.
   - Provides semantic retrieval across the entire knowledge base.

3. **LLM Synthesis & Reasoning**:
   - Summarizes long-form content.
   - Connects new information with past entries and personal goals in `personal-system/`.
   - Acts as a conversational assistant for your life manager.

---

## 📁 Directory Layout

```
hermes/
├── README.md           # Component documentation
├── main.py             # Hermes runtime entry point / CLI
├── config.py           # Configuration and environment loaders
└── services/           # Core modules (embeddings, llm, storage)
```

---

## 🛠️ Getting Started

```bash
# Example local execution
python hermes/main.py --help
```

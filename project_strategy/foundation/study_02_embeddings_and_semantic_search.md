# Study Guide: Embeddings, Vectors, and Semantic Search

> This guide explains how text becomes numbers, how those numbers capture meaning, and how semantic search finds things by concept rather than keyword. These ideas power the context engine, knowledge graph, and every "smart" retrieval feature in the workspace.

---

## 1. The Problem: Computers Don't Understand Words

If you search your codebase for `"fix the authentication bug"`, a traditional keyword search looks for the exact words "fix," "authentication," and "bug." It won't find a function named `repair_login_issue()` or a commit message that says `"patched session token validation"` — even though they're all about the same thing.

**Semantic search** solves this by searching *by meaning* rather than by exact string matching. To do that, we first need a way to represent the *meaning* of text as something a computer can work with. That's where embeddings come in.

---

## 2. What Is an Embedding?

An **embedding** is a list of numbers (a **vector**) that represents the meaning of a piece of text. Two pieces of text with similar meanings will have similar vectors.

```
"fix the authentication bug"  →  [0.12, -0.34, 0.87, 0.03, ..., 0.56]  (384 numbers)
"patched session token error" →  [0.11, -0.31, 0.85, 0.05, ..., 0.54]  (384 numbers)
"chocolate cake recipe"       →  [0.92, 0.14, -0.67, 0.44, ..., -0.21] (384 numbers)
```

Notice: the first two vectors have similar values (they mean similar things). The third is very different (unrelated topic).

### Where Do These Numbers Come From?

They come from a **transformer model** — a neural network that has been trained on enormous amounts of text. During training, the model learns to place semantically similar text near each other in a high-dimensional space.

The model used in this project is **all-MiniLM-L6-v2**, a 22-million-parameter model from the sentence-transformers library. It takes a string of text and outputs a 384-dimensional vector. "384-dimensional" means the output is a list of 384 floating-point numbers.

### Why 384 Dimensions?

You can think of each dimension as capturing some abstract aspect of meaning — but unlike human-interpretable categories (topic, sentiment, formality), these dimensions are learned automatically and don't have clean labels. The model figured out its own internal representation of meaning.

384 is a compromise: enough dimensions to represent nuanced distinctions between concepts, but small enough to store and search efficiently. Larger models (768 or 1536 dimensions) capture more nuance but cost more to compute and store.

---

## 3. Vector Spaces and Similarity

### What Is a Vector Space?

A vector space is a mathematical structure where vectors live. You can think of it geometrically:

- A 2D vector space is a flat plane (x, y coordinates)
- A 3D vector space is the physical space around you (x, y, z)
- A 384D vector space is... hard to visualize, but the math works exactly the same way

In this space, each embedded text chunk is a *point*. Chunks with similar meanings are clustered near each other. Unrelated chunks are far apart.

### Cosine Similarity

The standard way to measure "closeness" in embedding space is **cosine similarity**. It measures the *angle* between two vectors, ignoring their magnitude (length).

```
cosine_similarity(A, B) = (A · B) / (|A| × |B|)
```

Where:
- `A · B` is the **dot product** (multiply corresponding elements and sum them)
- `|A|` is the **magnitude** (square root of the sum of squared elements)

The result ranges from -1 to 1:
- **1.0** = identical direction (same meaning)
- **0.0** = perpendicular (unrelated)
- **-1.0** = opposite direction (opposite meaning)

In practice, most text embeddings fall between 0.0 and 1.0. A cosine similarity above ~0.7 usually indicates strong semantic relatedness.

### Concrete Example

```python
import numpy as np

# Simplified 4D embeddings (real ones are 384D)
auth_bug = np.array([0.9, 0.1, 0.8, 0.2])
token_fix = np.array([0.85, 0.15, 0.75, 0.25])
cake = np.array([0.1, 0.9, 0.2, 0.8])

def cosine_sim(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

print(cosine_sim(auth_bug, token_fix))  # ~0.99 (very similar)
print(cosine_sim(auth_bug, cake))        # ~0.36 (very different)
```

---

## 4. The Embedding Pipeline

Here's what happens when a file changes in the workspace:

```
1. File watcher detects a change
        │
        ▼
2. File is compared against stored hash (SHA-256)
   ─ If unchanged → skip (differential update)
   ─ If changed → continue
        │
        ▼
3. File is parsed into chunks
   ─ Code: tree-sitter splits into functions, classes, methods
   ─ Notes: split by headings/sections
   ─ Terminal: split by command/output blocks
        │
        ▼
4. Each chunk is passed through the embedding model
   ─ sentence-transformers → 384-dim vector
        │
        ▼
5. Vectors are stored in LanceDB alongside metadata
   ─ source_file, entity_id, chunk_type, language, etc.
```

### Smart Chunking

You don't embed an entire file as one vector. A single 2000-line Python file would produce a vector that's a blurry average of everything in it — useless for finding specific functions.

Instead, the file is **chunked** into meaningful units:
- A **function definition** is one chunk
- A **class** is one chunk (or the class header is one chunk and each method is another)
- A **markdown heading section** is one chunk
- A **terminal command + its output** is one chunk

This way, searching for "gradient accumulation" returns the specific function that implements it, not the entire training script.

### Differential Updates

You don't re-embed everything on every file save. The system tracks a **content hash** (SHA-256) for each file. When a file changes:

1. Compute the new hash
2. Compare with the stored hash
3. If different, re-parse and re-embed only the changed chunks

For code files, this can be even smarter: tree-sitter can identify which *specific functions* changed, so you only re-embed those functions instead of all functions in the file.

---

## 5. Vector Databases and LanceDB

### Why Not Just Use a List?

You could store all your vectors in a Python list and search by computing cosine similarity with every single vector. For 100 vectors, this works fine. For 100,000 vectors across a large codebase, it's too slow.

A **vector database** (like LanceDB) provides:

1. **Efficient similarity search** using specialized index structures (more below)
2. **Metadata filtering** — "search only Python functions" or "search only this branch"
3. **Persistence** — vectors survive process restarts
4. **CRUD operations** — add, update, delete individual vectors

### How Vector Search Works (ANN)

Exact nearest-neighbor search (comparing against every vector) is O(n) — too slow for large collections. Vector databases use **Approximate Nearest Neighbor (ANN)** algorithms that trade a tiny bit of accuracy for massive speed improvements.

Common approaches:

**IVF (Inverted File Index):** Cluster vectors into groups. At search time, only compare against clusters that are close to the query vector. If you have 1000 clusters and 100,000 vectors, searching 10 nearby clusters checks ~1000 vectors instead of 100,000.

**HNSW (Hierarchical Navigable Small World):** Build a graph where each vector is connected to its nearest neighbors. At search time, walk through the graph like a "hop, skip, jump" — start at a random point, jump to a closer neighbor, repeat. Typically returns excellent results in O(log n) time.

LanceDB uses its own disk-based indexing (built on Apache Arrow's columnar format) optimized for embedded/local use rather than distributed clusters.

### Hybrid Search

Pure vector search can miss results where the keyword matters. Pure keyword search misses semantic matches. **Hybrid search** combines both:

1. Vector similarity score (semantic meaning)
2. Keyword/full-text search score (exact terms)
3. Combined with weighted fusion: `final_score = α × vector_score + (1-α) × keyword_score`

LanceDB supports both vector search and full-text search, enabling this hybrid approach.

---

## 6. Embedding Models: Trade-offs

### Local Models (Used in This Project)

| Model | Dimensions | Size | Speed (CPU) | Quality |
|-------|-----------|------|-------------|---------|
| all-MiniLM-L6-v2 | 384 | 80 MB | ~50-100ms/chunk | Good general-purpose |
| codebert-base | 768 | 440 MB | ~100-200ms/chunk | Better for code |
| codellama-embed | 4096 | ~2 GB | ~500ms/chunk | Best for code, but heavy |

### API Models (Opt-in Upgrades)

| Provider | Model | Dimensions | Cost |
|----------|-------|-----------|------|
| OpenAI | text-embedding-3-small | 1536 | $0.02/1M tokens |
| Voyage AI | voyage-code-2 | 1536 | $0.12/1M tokens |
| Cohere | embed-english-v3 | 1024 | $0.10/1M tokens |

The local default (all-MiniLM-L6-v2) is the right starting point: it's fast, small, runs offline, and produces good-enough results for a solo developer's codebase. API models are available as quality upgrades for non-sensitive workspace profiles.

---

## 7. From Embeddings to Semantic Search

Putting it all together, here's what happens when you type a search query:

```
User types: "how does the attention mechanism work"
        │
        ▼
1. Embed the query using the same model
   → [0.23, -0.45, 0.67, ...]  (384-dim vector)
        │
        ▼
2. Search LanceDB for nearest neighbors
   ─ Optional: filter by source_type="code", language="python"
   ─ Returns top-K most similar vectors (e.g., top 10)
        │
        ▼
3. (Optional) Hybrid: also run full-text search for "attention mechanism"
        │
        ▼
4. Combine and re-rank results
   ─ Vector score + keyword score + recency boost + file-proximity boost
        │
        ▼
5. Return results with metadata
   ─ "attention.py:forward() — line 45-89" (similarity: 0.91)
   ─ "notes/attention_notes.md — Mechanism section" (similarity: 0.87)
   ─ "chat: debugging attention weights — Feb 12" (similarity: 0.82)
```

The search found a function, a note, and a chat thread — all semantically related to "attention mechanism" — even if none of them contained that exact phrase.

---

## 8. Embeddings in the Knowledge Graph

Embeddings don't just power search. They also power the **auto-linking** feature of the knowledge graph.

When a new entity is created (a new note, a new function, a new task), its embedding is compared against existing entity embeddings. If two entities have a cosine similarity above a threshold (e.g., 0.75), a `related_to` link is automatically created between them.

This is how the system notices that your note about "transformer attention" is related to the `MultiHeadAttention` class in your code, without you ever manually linking them.

---

## 9. Token Counts and Context Windows

Embeddings also help manage **LLM context windows**. When you ask the AI assistant a question, the system needs to decide which context to include in the prompt. The context window has a token limit (e.g., 128K tokens for Claude).

The retrieval process:

1. Embed the user's question
2. Find the most relevant chunks via semantic search
3. Pack chunks into the context window until the token budget is met
4. Send to the LLM

The `token_count` field stored alongside each embedding in LanceDB is used for this budget calculation — it tells the system how many tokens each chunk will consume before actually including it.

---

## Key Takeaways

1. **Embeddings convert meaning to numbers.** A transformer model maps text to a vector where semantic similarity corresponds to geometric proximity.

2. **Cosine similarity measures meaning closeness.** Two vectors pointing in the same direction represent similar concepts.

3. **Smart chunking is critical.** Embedding whole files produces useless averages. Embedding functions, sections, and commands produces precise, searchable units.

4. **Differential updates keep it efficient.** Only re-embed what changed, tracked by content hashes.

5. **Vector databases make search fast.** ANN algorithms like IVF and HNSW avoid brute-force comparison.

6. **Hybrid search is better than either alone.** Combine vector similarity (semantic) with keyword matching (exact terms) for the best recall.

7. **Embeddings power more than search.** They also drive auto-linking in the knowledge graph and context selection for LLM prompts.

---

## Further Reading

- [What Are Embeddings? (Vicki Boykis)](https://vickiboykis.com/what_are_embeddings/) — Comprehensive deep dive into embeddings
- [Sentence-Transformers Documentation](https://www.sbert.net/) — The library used for local embedding
- [LanceDB Documentation](https://lancedb.github.io/lancedb/) — The embedded vector database
- [Understanding ANN Search](https://www.pinecone.io/learn/what-is-similarity-search/) — Visual explanation of approximate nearest neighbors

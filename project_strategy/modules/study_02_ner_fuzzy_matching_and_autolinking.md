# Study Guide: Named Entity Recognition, Fuzzy Matching, and Auto-Linking

> This guide explains how the knowledge graph discovers relationships automatically — identifying meaningful entities in text, resolving them to existing graph nodes, and creating links. These techniques power the auto-linking engine described in `05_module_knowledge_graph.md`.

---

## 1. The Problem: Connecting Things Automatically

You write a note: "The attention function needs to handle variable-length sequences. See the Vaswani et al. paper for the masking approach."

A human immediately sees the connections:
- "attention function" → probably refers to `scaled_dot_product_attention()` in your code
- "Vaswani et al. paper" → probably refers to "Attention Is All You Need" (ArXiv 1706.03762)
- "masking approach" → relates to the `mask` parameter in that function

The auto-linking engine's job is to make these same connections programmatically. It does this in stages: first **extract** the references from text, then **resolve** them to specific entities, then **store** the links with confidence scores.

---

## 2. Named Entity Recognition (NER)

### What Is NER?

**Named Entity Recognition** is the task of identifying and classifying spans of text that refer to real-world things. In traditional NLP, NER finds categories like:

| Category | Examples |
|----------|---------|
| PERSON | "Vaswani", "John Smith" |
| ORGANIZATION | "Google", "MIT" |
| LOCATION | "San Francisco", "Building 42" |
| DATE | "last Thursday", "February 2024" |
| MONEY | "$1.2 million" |

For this project, we need **domain-specific NER** — recognizing categories like:

| Category | Examples |
|----------|---------|
| CODE_SYMBOL | `MultiHeadAttention`, `forward()`, `train.py` |
| ARXIV_REFERENCE | "Vaswani et al.", "ArXiv 2401.xxxxx" |
| FILE_PATH | `/src/models/attention.py`, `config.yaml` |
| TASK_MARKER | "TODO", "FIXME", "need to implement" |
| METRIC | "loss=0.342", "accuracy: 93.4%" |
| URL | "https://arxiv.org/abs/..." |

### How NER Works

NER systems generally fall into three categories:

**1. Rule-Based (Regex Patterns)**

The simplest and most reliable for structured patterns:

```python
import re

# File paths
FILE_PATH_PATTERN = r'[\w./\\-]+\.\w{1,10}'  # matches "src/train.py", "config.yaml"

# Code symbols (CamelCase or snake_case identifiers)
CODE_SYMBOL_PATTERN = r'\b[A-Z][a-zA-Z0-9]+(?:\.[a-z_]\w+)*(?:\(\))?'  # "MultiHeadAttention.forward()"

# ArXiv IDs
ARXIV_PATTERN = r'\d{4}\.\d{4,5}(?:v\d+)?'  # "1706.03762", "2401.12345v2"

# URLs
URL_PATTERN = r'https?://[^\s<>\"]+'

# TODO markers
TODO_PATTERN = r'\b(?:TODO|FIXME|HACK|BUG|XXX)\b'
```

**Pros:** Fast, deterministic, zero false positives for well-defined patterns (URLs, ArXiv IDs).
**Cons:** Can't handle fuzzy references like "the attention function" or "Vaswani et al."

**2. Statistical NER Models (spaCy)**

Pre-trained models that learn to recognize entities from labeled training data:

```python
import spacy
nlp = spacy.load("en_core_web_sm")

doc = nlp("See the Vaswani et al. paper for the masking approach")
for ent in doc.ents:
    print(f"{ent.text} → {ent.label_}")
# "Vaswani" → PERSON
```

spaCy's models are trained on general text (news articles, Wikipedia). They recognize standard entity categories (PERSON, ORG, DATE) well, but won't identify code-specific entities out of the box.

**Pros:** Handles natural language references ("the Vaswani paper"). Generalizes to patterns not covered by regex.
**Cons:** Needs fine-tuning for domain-specific entities. Medium confidence — may produce false positives.

**3. LLM-Based Extraction**

Use the local LLM to extract entities from text:

```
System: Extract all references to code, papers, people, and files from the following text. Return JSON.

User: "The attention function needs to handle variable-length sequences. See the Vaswani et al. paper for the masking approach."

LLM: {
  "code_references": ["attention function", "masking approach"],
  "paper_references": ["Vaswani et al."],
  "file_references": [],
  "people": ["Vaswani"]
}
```

**Pros:** Best understanding of natural language, handles ambiguity well, no training data needed.
**Cons:** Slow (200-500ms per extraction), requires LLM availability, variable output format.

### The Layered Approach

The auto-linking engine uses all three, in order of confidence:

```
Stage 1: Regex patterns (HIGH confidence)
    → URLs, ArXiv IDs, file paths, TODO markers, exact code symbols
    → Confidence: 0.95+

Stage 2: Symbol table matching (HIGH confidence)
    → Match extracted text against known entity titles from the knowledge graph
    → Confidence: 0.90+ for exact matches

Stage 3: spaCy NER (MEDIUM confidence)
    → Person names, organization names, dates
    → Confidence: 0.70-0.90

Stage 4: Embedding similarity (VARIABLE confidence)
    → Embed the reference text, search LanceDB for similar entities
    → Confidence: cosine similarity score (0.0-1.0)

Stage 5: LLM extraction (when available, for ambiguous text)
    → Natural language understanding of fuzzy references
    → Confidence: 0.75-0.90 (LLM-assigned)
```

---

## 3. Fuzzy String Matching

### The Problem

Exact string matching fails when text refers to entities with slight variations:

| Reference in Text | Actual Entity Name | Exact Match? |
|---|---|---|
| "attention function" | `scaled_dot_product_attention` | No |
| "the transformer class" | `TransformerModel` | No |
| "config file" | `config.yaml` | No |
| "train script" | `train.py` | No |

### Levenshtein Distance

The **Levenshtein distance** (edit distance) between two strings is the minimum number of single-character edits (insertions, deletions, substitutions) to transform one string into the other.

```
"kitten" → "sitting"

k → s (substitution)
kitten → sitten
sitten → sittin (substitution: e → i)
sittin → sitting (insertion: g)

Levenshtein distance = 3
```

This is useful for catching typos and minor variations:

```
"MultiHeadAtention" → "MultiHeadAttention"  (distance = 1, missing 't')
"transformr.py" → "transformer.py"          (distance = 2)
```

### Normalized Similarity Score

Raw Levenshtein distance isn't directly comparable across different-length strings. A distance of 3 is significant for a 5-character string but trivial for a 50-character string. **Normalized similarity** accounts for this:

```
similarity = 1 - (edit_distance / max(len(string1), len(string2)))

"MultiHeadAtention" vs "MultiHeadAttention":
  distance = 1, max_length = 18
  similarity = 1 - (1/18) = 0.944 → HIGH confidence match
```

### Token-Based Matching

For longer references, **token-level matching** works better than character-level:

```
Reference: "the scaled attention function"
Candidate: "scaled_dot_product_attention"

Character-level Levenshtein: very different (lots of edits)
Token-level comparison:
  Reference tokens: {"scaled", "attention", "function"}
  Candidate tokens: {"scaled", "dot", "product", "attention"}
  Overlap: {"scaled", "attention"} → 2 of 3 reference tokens found
  Token similarity: 2/3 = 0.67
```

This explains how "the attention function" can match `scaled_dot_product_attention` — the meaningful tokens overlap even though the exact strings are very different.

### Practical Libraries

**Python `rapidfuzz`** (or `thefuzz`/`fuzzywuzzy`):

```python
from rapidfuzz import fuzz

# Simple ratio (character-level)
fuzz.ratio("attention function", "scaled_dot_product_attention")  # ~45

# Token sort ratio (order-independent token matching)
fuzz.token_sort_ratio("attention function", "scaled_dot_product_attention")  # ~65

# Partial ratio (best substring match)
fuzz.partial_ratio("attention", "scaled_dot_product_attention")  # 100
```

The auto-linker uses multiple fuzzy matching strategies and takes the best score.

---

## 4. Entity Resolution

### What Is Entity Resolution?

After NER extracts a reference like "the attention function" from text, **entity resolution** determines *which specific entity* in the knowledge graph it refers to.

This is harder than it sounds. Your codebase might have:
- `scaled_dot_product_attention()` in `attention.py`
- `MultiHeadAttention` class in `transformer.py`
- `attention_weights` variable in `train.py`
- A note titled "Attention Mechanism Overview"

Which one does "the attention function" refer to?

### Resolution Strategy (Cascade)

The system tries increasingly fuzzy matching, stopping at the first confident result:

```
Reference: "the attention function"
    │
    ▼
1. Exact match against entity titles
   → No exact match for "the attention function"
    │
    ▼
2. Exact substring match
   → "attention" appears in multiple entity titles
   → Multiple candidates, need disambiguation
    │
    ▼
3. Fuzzy string match (Levenshtein/token)
   → "attention function" vs "scaled_dot_product_attention": token overlap = 0.67
   → "attention function" vs "MultiHeadAttention": token overlap = 0.50
   → Best match: scaled_dot_product_attention (0.67)
   → But 0.67 is below auto-commit threshold (0.85)
    │
    ▼
4. Semantic match (embedding similarity)
   → Embed "the attention function"
   → Search LanceDB for nearest neighbors
   → Result: scaled_dot_product_attention chunk (cosine similarity = 0.89)
   → 0.89 > 0.85 threshold → auto-commit link!
    │
    ▼
Link created: Note ──mentions──► CodeUnit(scaled_dot_product_attention)
    confidence: 0.89
    auto_generated: true
    context: "mentioned in line 1 of note 'Attention Notes'"
```

### Disambiguation Signals

When multiple candidates exist, additional signals help disambiguate:

**Recency:** If you just edited `attention.py`, references to "attention" more likely refer to code in that file.

**Session context:** If `transformer.py` is the active file, "the transformer class" probably refers to the class in that file, not a similar class in another file.

**Co-occurrence:** If a note mentions both "attention" and "transformer," and `MultiHeadAttention` is a class inside `TransformerModel`, that co-occurrence strengthens the link.

**Explicit file references:** If the note says "the attention function in attention.py," the file reference narrows candidates to entities in `attention.py`.

---

## 5. Confidence Scoring and Thresholds

### Why Confidence Matters

Not all auto-discovered links are correct. A semantic similarity of 0.72 might mean "probably related" or "coincidentally similar." The confidence score communicates this uncertainty to both the system and the user.

### How Confidence Is Calculated

Different extraction methods produce different confidence levels:

```
Final confidence = method_confidence × match_quality

Where:
  method_confidence:
    Regex exact match:     1.0
    Symbol table match:    0.95
    Fuzzy string (high):   0.90
    spaCy NER:            0.80
    Embedding similarity:  0.85
    LLM extraction:       0.80

  match_quality:
    Exact match:           1.0
    Levenshtein sim > 0.9: 0.95
    Token overlap > 0.8:   0.90
    Cosine sim > 0.85:     cosine_sim value
    Cosine sim 0.70-0.85:  cosine_sim × 0.9 (discounted)
```

### Threshold Actions

| Score Range | Action | UI |
|---|---|---|
| 0.95 - 1.0 | Auto-commit link | Solid line in graph view |
| 0.85 - 0.95 | Auto-commit link | Solid line in graph view |
| 0.70 - 0.85 | Suggest to user | Dashed line, "Confirm?" prompt |
| < 0.70 | Discard | Not shown |

The key insight: **auto-commit above 0.85 but show suggestions between 0.70-0.85**. This lets the system be aggressive about obvious links while deferring uncertain ones to human judgment.

### Learning from User Corrections

When a user confirms or dismisses a suggested link, the system logs the feedback:

```python
class LinkFeedback:
    link_id: str
    user_action: "confirm" | "dismiss"
    original_confidence: float
    extraction_method: str
    reference_text: str
    entity_matched: str
```

Over time, this data could be used to:
- Adjust confidence thresholds per entity type
- Boost/penalize specific matching methods
- Build a user-specific synonym dictionary ("when JT says 'attention function,' they mean `scaled_dot_product_attention`")

---

## 6. Temporal Co-Occurrence Linking

### The Idea

Not all relationships are found by analyzing text content. Some are discovered by *when things happen together*:

- You write a note while `transformer.py` is open → the note probably relates to that code
- A git commit happens 30 seconds after a terminal error → the commit probably fixes that error
- You create a task right after reading a paper → the task probably relates to the paper

### How It Works

The system tracks **session context** — what's active at any given moment:

```python
session_context = {
    "active_file": "src/models/transformer.py",
    "active_function": "MultiHeadAttention.forward",
    "recent_terminal_commands": ["python train.py --epochs 10"],
    "recent_notes_modified": ["attention_notes.md"],
    "recent_chat_messages": ["How do I fix the masking?"],
    "timestamp": "2024-02-24T14:32:00"
}
```

When a new entity is created (new note, new commit, new task), the system checks what was active within a configurable time window (e.g., 5 minutes):

```
New note created at 14:32
    │
    ▼
What was active within ±5 minutes?
    ├── transformer.py (active file at 14:30-14:35)
    ├── "python train.py" (command at 14:28, exit code 1)
    └── chat message "How do I fix the masking?" (14:31)
    │
    ▼
Create co_occurred links:
    ├── Note ──co_occurred──► CodeUnit(transformer.py) [confidence: 0.75]
    ├── Note ──co_occurred──► TerminalSession(python train.py) [confidence: 0.65]
    └── Note ──co_occurred──► ChatThread(masking discussion) [confidence: 0.70]
```

### Temporal Sequence Links

For ordered events:

```
14:28  Terminal error (python train.py → exit code 1)
14:29  Note created: "OOM issue with attention layer"
14:35  Code edited: transformer.py (reduced batch size)
14:36  Terminal success (python train.py → exit code 0)
14:37  Git commit: "fix OOM by reducing batch size"

Sequence links:
  Terminal(error) ──followed_by──► Note(OOM issue)
  Note(OOM issue) ──followed_by──► CodeEdit(transformer.py)
  CodeEdit ──followed_by──► Terminal(success)
  Terminal(success) ──followed_by──► GitEvent(fix commit)
```

This creates a narrative thread: error → investigation → fix → verification → commit. The session state capture uses these sequences to generate meaningful `blockers` and `next_steps`.

---

## 7. Full-Text Search with SQLite FTS5

### What Is FTS5?

**FTS5** (Full-Text Search version 5) is a SQLite extension that provides fast keyword search over text columns. It builds an **inverted index** — a mapping from every word to the rows that contain it.

### How Inverted Indexes Work

Normal table scan:
```
Query: "attention mechanism"
→ Read row 1, check if content contains "attention" AND "mechanism"
→ Read row 2, check...
→ Read row 3, check...
→ ... (scan all N rows) → O(n)
```

Inverted index:
```
Index:
  "attention" → [row 3, row 7, row 15, row 42]
  "mechanism" → [row 7, row 15, row 89]

Query: "attention mechanism"
→ Look up "attention" → {3, 7, 15, 42}
→ Look up "mechanism" → {7, 15, 89}
→ Intersection: {7, 15}
→ Done! O(1) lookups, O(k) intersection where k is result set size
```

### BM25 Ranking

FTS5 uses **BM25** (Best Match 25) to rank results by relevance. BM25 considers:

- **Term frequency (TF):** How often the search term appears in a document. More occurrences → higher score, with diminishing returns.
- **Inverse document frequency (IDF):** How rare the term is across all documents. Rare terms are more discriminative — "attention" in a machine learning codebase is common (low IDF), but "quaternion" is rare (high IDF).
- **Document length:** Longer documents naturally contain more words. BM25 normalizes for this so short documents with the search term aren't penalized.

The formula: `score = IDF × (TF × (k1 + 1)) / (TF + k1 × (1 - b + b × docLength/avgDocLength))`

You don't need to memorize this — the key insight is that BM25 balances "how much does this document talk about the query term" against "how common is this term overall."

### Hybrid Search: BM25 + Vector Similarity

The universal search combines FTS5 keyword search with vector semantic search:

```
User query: "attention masking implementation"
    │
    ├──► FTS5: keyword search on entity titles + content
    │    Returns: rows containing "attention" AND "masking" AND "implementation"
    │    Ranked by BM25 score
    │
    ├──► LanceDB: embed query → vector similarity search
    │    Returns: semantically similar chunks
    │    Ranked by cosine similarity
    │
    ▼
Merge results with weighted fusion:
    final_score = α × normalized_vector_score + (1-α) × normalized_bm25_score
    Default: α = 0.7 (semantic similarity weighted higher)
```

Why both? Keyword search finds exact matches that semantic search might miss (specific variable names, error codes). Semantic search finds conceptual matches that keyword search misses ("padding approach" → `mask` parameter).

---

## Key Takeaways

1. **NER extracts references from text.** Rule-based (regex) for structured patterns, statistical models (spaCy) for natural language, LLMs for ambiguous cases.

2. **Fuzzy matching handles variations.** Levenshtein distance catches typos. Token-based matching catches paraphrases. The system tries multiple strategies and takes the best.

3. **Entity resolution maps references to graph nodes.** A cascade from exact match → fuzzy match → semantic match, stopping at the first confident result.

4. **Confidence scores express uncertainty.** High-confidence links are auto-committed. Uncertain links are surfaced as suggestions. Low-confidence matches are discarded.

5. **Temporal co-occurrence finds implicit relationships.** Things that happen together are likely related — the note you write while editing a file probably relates to that file.

6. **Hybrid search combines keyword and semantic.** BM25 for exact term matching, vector similarity for conceptual matching. Together they achieve better recall than either alone.

---

## Further Reading

- [spaCy NER Tutorial](https://spacy.io/usage/linguistic-features#named-entities) — Named entity recognition with spaCy
- [rapidfuzz Documentation](https://rapidfuzz.github.io/RapidFuzz/) — Fast fuzzy string matching in Python
- [Levenshtein Distance Explained](https://en.wikipedia.org/wiki/Levenshtein_distance) — The algorithm behind edit distance
- [SQLite FTS5](https://www.sqlite.org/fts5.html) — Full-text search extension documentation
- [BM25 Explained](https://www.elastic.co/blog/practical-bm25-part-2-the-bm25-algorithm-and-its-variables) — The ranking algorithm behind keyword search

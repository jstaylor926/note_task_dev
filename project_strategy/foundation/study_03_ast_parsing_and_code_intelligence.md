# Study Guide: AST Parsing, tree-sitter, and Code Intelligence

> This guide explains how code is structurally understood by machines — not as raw text, but as a syntax tree. This is the foundation for smart chunking, entity extraction, code navigation, and the editor's context-aware features.

---

## 1. Why Parse Code?

When you look at a Python file, you instantly recognize functions, classes, imports, and variables. You know that `def forward(self, x):` starts a method and that the indented lines below it are the method body.

A computer sees this:

```
d e f   f o r w a r d ( s e l f ,   x ) : \n     r e t u r n ...
```

Just a sequence of characters. To do anything intelligent with code — chunking it for embedding, extracting function signatures, detecting imports, providing autocomplete — the computer needs to understand the **structure** of the code, not just the characters.

That structure is called an **Abstract Syntax Tree (AST)**.

---

## 2. What Is an Abstract Syntax Tree?

An AST represents the hierarchical structure of source code. Each **node** in the tree represents a syntactic construct (a function definition, an assignment, an expression, a parameter).

Consider this Python code:

```python
def add(a, b):
    return a + b
```

Its AST looks something like:

```
module
└── function_definition
    ├── name: "add"
    ├── parameters
    │   ├── identifier: "a"
    │   └── identifier: "b"
    └── body
        └── return_statement
            └── binary_expression
                ├── left: identifier "a"
                ├── operator: "+"
                └── right: identifier "b"
```

The tree captures that `add` is a function with two parameters (`a`, `b`) and a body that returns the sum of those parameters. It doesn't care about whitespace, indentation style, or whether you used tabs or spaces — that's what "abstract" means. The tree captures the *meaning of the syntax*, not the formatting.

### Concrete vs. Abstract Syntax Trees

A **Concrete Syntax Tree (CST)** preserves every detail of the source text — every space, newline, comment, and parenthesis. tree-sitter actually produces a CST (it calls them "syntax trees") because it needs to map back to exact source positions for editor features.

An **Abstract Syntax Tree (AST)** discards syntactic sugar and whitespace, keeping only the meaningful structure. Python's built-in `ast` module produces ASTs.

For this project, tree-sitter's CST approach is preferred because we need precise source positions (line numbers, byte offsets) for editor annotations and smart chunking.

---

## 3. How Parsing Works

### Lexing (Tokenization)

The first step is **lexing** — breaking the character stream into **tokens** (meaningful units):

```
"def add(a, b):\n    return a + b"

→ [DEF, IDENTIFIER("add"), LPAREN, IDENTIFIER("a"), COMMA,
   IDENTIFIER("b"), RPAREN, COLON, NEWLINE, INDENT, RETURN,
   IDENTIFIER("a"), PLUS, IDENTIFIER("b"), NEWLINE, DEDENT]
```

Each token has a type (keyword, identifier, operator, punctuation) and a value.

### Parsing (Tree Construction)

The parser takes the token stream and builds a tree according to the language's **grammar** — the formal rules that define valid syntax.

A grammar rule for Python functions might look like:

```
function_definition → "def" IDENTIFIER "(" parameter_list ")" ":" suite
parameter_list → IDENTIFIER ("," IDENTIFIER)*
suite → NEWLINE INDENT statement+ DEDENT
```

The parser matches these rules against the token stream, building tree nodes as it goes. If the input doesn't match any rule, you get a **syntax error**.

---

## 4. tree-sitter: The Engine Behind It All

### What Makes tree-sitter Special?

tree-sitter is an **incremental parsing** library. Most parsers rebuild the entire tree from scratch when the source changes. tree-sitter reuses unchanged parts of the previous tree and only re-parses the sections that were edited.

This is critical for two use cases:

1. **Real-time editor feedback:** When you type a character in the editor, tree-sitter updates the syntax tree in under 1ms (for most edits). This enables instant syntax highlighting, bracket matching, and structural navigation.

2. **Efficient re-indexing:** When a file changes on disk, tree-sitter can parse just the delta, and the system can identify which specific functions/classes were modified — enabling re-embedding of only the changed chunks.

### How Incremental Parsing Works

tree-sitter uses a **GLR (Generalized LR) parser** with tree reuse:

1. The parser stores the previous syntax tree
2. When an edit occurs (e.g., inserting text at position 47), tree-sitter receives the edit description: "characters 47-47 were replaced with 'x'"
3. It marks the affected tree nodes as "dirty"
4. Only dirty nodes and their ancestors are re-parsed
5. Unchanged subtrees are reused directly from the previous tree

For a 10,000-line file where you edited one function, this means re-parsing ~50 lines instead of 10,000.

### Language Grammars

tree-sitter doesn't know any language by default. Each language has a **grammar file** (written in a JSON DSL or JavaScript) that defines its syntax rules. These grammars are compiled into C code (parser state tables) that tree-sitter loads at runtime.

Pre-built grammars exist for 30+ languages. The `tree-sitter-languages` Python package bundles compiled grammars for common languages, so you can parse Python, JavaScript, Rust, Go, C/C++, Java, TypeScript, and more without compiling anything yourself.

```python
import tree_sitter_languages

parser = tree_sitter_languages.get_parser("python")
tree = parser.parse(b"def hello(): pass")
root = tree.root_node

print(root.type)           # "module"
print(root.children[0].type)  # "function_definition"
```

---

## 5. tree-sitter Queries

tree-sitter provides a **query language** for finding patterns in syntax trees. This is how you extract specific constructs (all function definitions, all imports, all class methods).

### Query Syntax

```scheme
;; Find all function definitions in Python
(function_definition
  name: (identifier) @function.name
  parameters: (parameters) @function.params
  body: (block) @function.body) @function.def
```

This query says: "Find nodes of type `function_definition`, and capture the `name`, `parameters`, and `body` sub-nodes with the labels `@function.name`, `@function.params`, and `@function.body`."

### How Queries Are Used in This Project

**Smart chunking for embedding:**
```scheme
;; Capture function-level chunks
(function_definition) @chunk
(class_definition) @chunk
(decorated_definition) @chunk
```

This query finds every function, class, and decorated definition in a file. Each match becomes a chunk for embedding.

**Entity extraction for the knowledge graph:**
```scheme
;; Capture import statements
(import_statement) @import
(import_from_statement
  module_name: (dotted_name) @module) @import
```

This finds all imports, which the system uses to build `depends_on` links between code entities.

**Editor annotations:**
```scheme
;; Find all TODO/FIXME comments
(comment) @comment
(#match? @comment "TODO|FIXME|HACK|XXX")
```

This finds comments containing task keywords, which can be highlighted in the editor and extracted as Task entities.

---

## 6. From Parse Trees to Smart Chunks

The context engine uses tree-sitter to split code files into semantically meaningful chunks for embedding. Here's the full pipeline:

```
Source file: training.py (500 lines)
        │
        ▼
1. Parse with tree-sitter → syntax tree
        │
        ▼
2. Walk the tree, extracting top-level constructs:
   ─ import block (lines 1-12)
   ─ class Trainer (lines 14-180)
     ─ method __init__ (lines 15-45)
     ─ method train_epoch (lines 47-120)
     ─ method evaluate (lines 122-178)
   ─ function main (lines 182-210)
   ─ if __name__ == "__main__" block (lines 212-215)
        │
        ▼
3. Chunking decisions:
   ─ Class too large for one chunk → split into per-method chunks
   ─ Each method becomes its own chunk with the class name as context
   ─ Import block is one chunk
   ─ Standalone function is one chunk
        │
        ▼
4. Each chunk is embedded separately:
   ─ "Trainer.__init__" → vector_1
   ─ "Trainer.train_epoch" → vector_2
   ─ "Trainer.evaluate" → vector_3
   ─ "main" → vector_4
```

### Why AST-Based Chunking Beats Naive Splitting

**Naive approach:** Split the file every 500 characters or every 20 lines. This might cut a function in half — the embedding for each half captures incomplete meaning.

**AST-based approach:** Split at syntactic boundaries (function/class/method). Each chunk is a complete, self-contained unit of code. The embedding captures the full meaning of that unit.

### Handling Large Constructs

What if a single function is 500 lines long? The system has thresholds:
- If a function exceeds the token limit (e.g., 512 tokens), it can be split into sub-chunks at block boundaries (if/else branches, loops, try/except blocks)
- Each sub-chunk includes the function signature as a prefix for context

---

## 7. Code Intelligence Features Powered by AST

### Semantic Annotations in the Editor

tree-sitter provides the syntax tree; CodeMirror 6 renders annotations based on it:

- **Syntax highlighting:** Instead of regex-based highlighting (which breaks on edge cases), tree-sitter tells the editor exactly what each token is — keyword, string, comment, function name, type annotation — and the editor applies the correct styles.

- **Bracket matching:** The tree knows which opening brace pairs with which closing brace, even in complex nested expressions.

- **Code folding:** The tree identifies block boundaries (function bodies, class bodies, loop bodies), enabling the editor to fold/unfold sections.

### Cross-Reference Detection

By parsing imports and function calls, the system can build a dependency graph:

```python
# File: train.py
from model import TransformerModel    # depends_on: model.py → TransformerModel
from utils import load_config          # depends_on: utils.py → load_config

model = TransformerModel(config)       # references: TransformerModel
config = load_config("config.yaml")    # references: load_config
```

tree-sitter identifies these references structurally (not by regex), so it handles aliased imports, qualified names, and nested references correctly.

### Function Signature Extraction

For the knowledge graph's `CodeUnit` entity type, tree-sitter extracts:
- Function/method name
- Parameter list with type annotations (if present)
- Return type annotation (if present)
- Decorators
- Start/end line numbers
- The class it belongs to (if it's a method)

This metadata is stored in the entity's `metadata` JSON field and used for search, display, and context injection into LLM prompts.

---

## 8. Language Server Protocol (LSP) and Its Relationship to tree-sitter

### What Is LSP?

The **Language Server Protocol** is a standard for communication between a code editor and a **language server** — a process that provides language-specific intelligence (autocomplete, go-to-definition, find-references, diagnostics).

Microsoft created LSP for VS Code, but it's now used by many editors. The idea: instead of every editor implementing Python autocomplete separately, one Python language server (like Pyright or pylsp) provides it, and any LSP-compatible editor can use it.

### LSP vs. tree-sitter: Different Levels of Understanding

| Feature | tree-sitter | LSP (Language Server) |
|---------|------------|----------------------|
| Speed | Sub-millisecond | 10-100ms per request |
| Understanding | Syntax (structure) | Semantics (meaning, types, scopes) |
| "What is this token?" | "It's a function_definition node" | "It's a function returning Optional[Tensor] that takes a parameter of type int" |
| Go to definition | Can find the definition node in the same file | Can follow imports across files, resolve virtual methods, find the actual implementation |
| Autocomplete | Can suggest syntactically valid completions | Can suggest type-correct completions with docstrings |
| Offline | Yes (just a parser) | Yes (runs locally as a process) |

**In this project, both are used:**
- tree-sitter: fast syntax highlighting, code folding, smart chunking, structural search (runs on every keystroke)
- LSP: deep intelligence features like autocomplete, go-to-definition, find-references, rename-symbol (runs on-demand per user action)

### How LSP Communication Works

LSP uses JSON-RPC over stdio (standard input/output):

```
Editor → Language Server:
{
  "jsonrpc": "2.0",
  "method": "textDocument/completion",
  "params": {
    "textDocument": { "uri": "file:///path/to/train.py" },
    "position": { "line": 42, "character": 10 }
  }
}

Language Server → Editor:
{
  "jsonrpc": "2.0",
  "result": {
    "items": [
      { "label": "forward", "kind": 3, "detail": "(self, x: Tensor) -> Tensor" },
      { "label": "freeze", "kind": 3, "detail": "() -> None" }
    ]
  }
}
```

The editor and language server are separate processes communicating through this protocol. In this project, the language server would be spawned and managed by the Tauri Rust layer, with CodeMirror acting as the LSP client.

---

## 9. Incremental Re-Indexing: Bringing It Together

Here's the full flow when you save a file, showing how tree-sitter, embeddings, and the knowledge graph interact:

```
1. File watcher detects: train.py changed
        │
        ▼
2. Compute SHA-256 of new file content
   Compare with stored hash in file_index table
   ─ Hash changed → continue
        │
        ▼
3. Parse with tree-sitter (incremental)
   ─ Previous tree is updated, only changed nodes re-parsed
        │
        ▼
4. Extract function/class nodes from the new tree
   ─ Compare node hashes with previous versions
   ─ Identify: Trainer.train_epoch was modified
   ─ Identify: new function validate_batch was added
        │
        ▼
5. Update chunks:
   ─ Re-embed Trainer.train_epoch (content changed)
   ─ Embed validate_batch (new chunk)
   ─ Leave all other chunks untouched in LanceDB
        │
        ▼
6. Update knowledge graph:
   ─ Update CodeUnit entity for Trainer.train_epoch
   ─ Create new CodeUnit entity for validate_batch
   ─ Run auto-linker on new/modified entities
   ─ Detect that validate_batch imports from utils → create depends_on link
        │
        ▼
7. Emit event to frontend → refresh search index, update annotations
```

This entire pipeline runs in the background, triggered by file saves, without the user doing anything. That's Principle 2 in action: "Automatic Over Manual."

---

## Key Takeaways

1. **ASTs reveal structure.** Parsing code into a tree transforms raw characters into a meaningful hierarchy of functions, classes, expressions, and statements.

2. **tree-sitter is incremental.** It only re-parses what changed, making it fast enough for real-time editor feedback and efficient background re-indexing.

3. **Queries extract patterns.** tree-sitter's query language lets you find specific constructs (all functions, all imports, all TODO comments) without fragile regex.

4. **AST chunking produces better embeddings.** Splitting at syntactic boundaries (functions, classes) creates coherent, self-contained units that embed well.

5. **tree-sitter and LSP complement each other.** tree-sitter handles fast, syntax-level features. LSP handles deep, semantic-level features. Both are needed for a full code intelligence experience.

6. **The parsing pipeline connects to everything.** Parse tree → smart chunks → embeddings → semantic search → knowledge graph. It's the foundation of the context engine.

---

## Further Reading

- [tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/) — Official docs with playground for testing queries
- [py-tree-sitter](https://github.com/tree-sitter/py-tree-sitter) — Python bindings
- [tree-sitter Query Syntax](https://tree-sitter.github.io/tree-sitter/using-parsers#pattern-matching-with-queries) — Full query language reference
- [LSP Specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) — The protocol specification
- [Crafting Interpreters — Parsing](https://craftinginterpreters.com/parsing-expressions.html) — Excellent book chapter on how parsers work from first principles

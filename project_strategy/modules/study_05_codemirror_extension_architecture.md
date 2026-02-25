# Study Guide: CodeMirror 6 Extension Architecture

> This guide explains how CodeMirror 6's extension system works — how the editor manages state, how extensions add features, and how the context engine integrates with the editor at a deep level. These concepts underpin the IDE module described in `06_module_ide.md`.

---

## 1. Why CodeMirror 6?

### The Predecessor Problem

CodeMirror 5 (and Monaco, VS Code's editor) use an imperative, object-oriented API: you get an editor instance and call methods on it (`editor.setValue()`, `editor.addLineWidget()`). This works until you have many extensions that all want to modify the editor simultaneously — they step on each other, cause race conditions, and create hard-to-debug interactions.

### The CodeMirror 6 Philosophy

CodeMirror 6 was rewritten from scratch with a different philosophy: **the editor is a pure function of its state**. Instead of imperatively mutating the editor, you describe a new state and the editor figures out what changed and updates the DOM accordingly.

This is the same idea behind React and SolidJS (declarative UI), but applied to a code editor. It's what makes it possible for the context engine to inject semantic annotations, cross-references, and AI suggestions without conflicting with syntax highlighting, bracket matching, or the user's typing.

---

## 2. The State Model

### EditorState

The entire editor is described by an immutable **EditorState** object:

```typescript
interface EditorState {
    doc: Text;              // The document content (a rope data structure)
    selection: EditorSelection;  // Cursor position(s) and selection ranges
    // ... plus all extension state (syntax tree, diagnostics, decorations, etc.)
}
```

**Immutable** means you never modify state directly. Instead, you create a **transaction** that describes changes, and a new state is computed:

```
Old State + Transaction → New State
```

```typescript
// Create a transaction that inserts "hello" at position 0
const transaction = state.update({
    changes: { from: 0, insert: "hello" }
});

// Apply the transaction to get a new state
const newState = transaction.state;
// Old state is unchanged. New state has "hello" at the beginning.
```

### Why Immutability?

Immutability makes the editor predictable:

- **Undo/redo** is trivial: keep a list of previous states, navigate backward and forward
- **Extensions don't conflict:** Each extension reads the current state and proposes changes via transactions. The editor applies all changes atomically.
- **Testing is simple:** Create a state, apply a transaction, check the result. No mocking, no setup.

---

## 3. Extensions: How Features Are Added

### What Is an Extension?

An **extension** is a value that adds behavior to the editor. Extensions can:

- Add visual decorations (syntax highlighting, error squiggles, annotations)
- Define new state fields (store custom data alongside the document)
- Handle user input (keymap, mouse events)
- Modify transactions (auto-indent, bracket closing)
- Provide completion sources (autocomplete suggestions)
- Define facets (configurable behaviors)

### Extension Composition

Extensions are composed into an array that's passed to the editor on creation:

```typescript
import { EditorView, basicSetup } from "@codemirror/basic-setup";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

const editor = new EditorView({
    extensions: [
        basicSetup,              // Line numbers, bracket matching, etc.
        python(),                // Python language support
        oneDark,                 // Dark theme
        mySemanticAnnotations(), // Custom: knowledge graph annotations
        myAICompletions(),       // Custom: AI-powered completions
    ],
    parent: document.getElementById("editor"),
});
```

The order matters for some things (later extensions can override earlier ones for keybindings), but generally extensions compose without conflict because they operate through the state system.

---

## 4. Key Building Blocks

### State Fields

A **state field** stores custom data that persists across state updates. When a transaction is applied, the field's `update` function computes the new field value.

```typescript
import { StateField, StateEffect } from "@codemirror/state";

// Define an effect to set annotations
const setAnnotations = StateEffect.define<Annotation[]>();

// Define a state field that stores annotations
const annotationField = StateField.define<Annotation[]>({
    create() {
        return [];  // Initial value: empty array
    },
    update(annotations, transaction) {
        // Check if this transaction has annotation effects
        for (let effect of transaction.effects) {
            if (effect.is(setAnnotations)) {
                return effect.value;  // Replace annotations
            }
        }
        // If the document changed, adjust annotation positions
        if (transaction.docChanged) {
            return annotations.map(a => ({
                ...a,
                pos: transaction.changes.mapPos(a.pos)
            }));
        }
        return annotations;  // No change
    }
});
```

**Key concept: `mapPos()`** — When the document changes (text inserted or deleted), positions in the document shift. `mapPos()` adjusts a position through a set of changes, so an annotation at position 42 moves to position 47 if 5 characters were inserted before it. This is how annotations "stick" to their code even as the user edits.

### Decorations

**Decorations** are visual modifications to the editor display. They don't change the document — they add visual elements on top of it.

Types of decorations:

**Mark decorations:** Style a range of text (like syntax highlighting or error underlines):
```typescript
Decoration.mark({ class: "cm-error-underline" }).range(from, to)
```

**Widget decorations:** Insert an arbitrary DOM element at a position:
```typescript
Decoration.widget({
    widget: new AnnotationBadgeWidget(noteCount, experimentCount),
    side: 1  // 1 = after the position
}).range(pos)
```

**Line decorations:** Apply styles to an entire line:
```typescript
Decoration.line({ class: "cm-active-line" }).range(lineStart)
```

**Replace decorations:** Replace a range of text with a widget (used for code folding):
```typescript
Decoration.replace({ widget: new FoldWidget() }).range(from, to)
```

### How Decorations Are Provided

Decorations are produced by a **view plugin** or derived from a **state field** via a `DecorationSet`:

```typescript
import { ViewPlugin, DecorationSet, Decoration } from "@codemirror/view";

const semanticHighlighter = ViewPlugin.define(view => ({
    decorations: buildDecorations(view),

    update(update) {
        if (update.docChanged || update.viewportChanged) {
            this.decorations = buildDecorations(update.view);
        }
    }
}), {
    decorations: plugin => plugin.decorations
});

function buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    // Query knowledge graph for entities in visible range
    // Add decorations for each entity
    for (const entity of getVisibleEntities(view)) {
        builder.add(entity.from, entity.to,
            Decoration.mark({ class: `cm-entity-${entity.type}` }));
    }
    return builder.finish();
}
```

### Facets

**Facets** are a mechanism for multiple extensions to contribute values that are combined into a single result. Think of them as "configurable slots."

```typescript
import { Facet } from "@codemirror/state";

// Define a facet for completion sources
const completionSources = Facet.define<CompletionSource>();

// Multiple extensions can provide completion sources:
const lspCompletions = completionSources.of(lspCompletionSource);
const aiCompletions = completionSources.of(aiCompletionSource);
const contextCompletions = completionSources.of(contextCompletionSource);

// The editor combines all sources when showing completions
```

When the user triggers autocomplete, the editor gathers results from ALL registered completion sources (LSP, AI, context engine) and merges them into a single suggestion list. This is how the three-priority autocomplete system works.

---

## 5. How the Context Engine Integrates

### Semantic Annotations (Hover Badges)

When a file is opened, the editor queries the knowledge graph for entities linked to CodeUnits in this file:

```
File opened: transformer.py
    │
    ▼
Query: SELECT e.title, e.entity_type, el.source_entity_id
       FROM entity_links el
       JOIN entities e ON e.id = el.source_entity_id
       WHERE el.target_entity_id IN (
           SELECT id FROM entities
           WHERE source_file = 'transformer.py' AND entity_type = 'CodeUnit'
       )
    │
    ▼
Results:
    ├── "Attention Notes" (Note) → linked to forward() at line 45
    ├── "run-041" (Experiment) → linked to MultiHeadAttention at line 14
    ├── "Optimize attention" (Task) → linked to forward() at line 45
    │
    ▼
Create decorations:
    ├── Widget at line 14: "🧪 1 experiment"
    ├── Widget at line 45: "📝 1 note · ✅ 1 task · 🧪 1 experiment"
```

These widgets are CodeMirror widget decorations. Hovering over them opens a tooltip (another widget decoration) showing the linked entities with click-through navigation.

### Ghost Text (AI Suggestions)

Inline AI suggestions use a combination of a state field and widget decorations:

```typescript
// State field stores the current suggestion
const suggestionField = StateField.define<Suggestion | null>({
    create() { return null; },
    update(suggestion, tr) {
        for (let effect of tr.effects) {
            if (effect.is(setSuggestion)) return effect.value;
            if (effect.is(clearSuggestion)) return null;
        }
        // Clear suggestion if user typed something
        if (tr.docChanged) return null;
        return suggestion;
    }
});

// Decoration renders the suggestion as ghost text
const suggestionDecoration = EditorView.decorations.compute(
    [suggestionField],
    state => {
        const suggestion = state.field(suggestionField);
        if (!suggestion) return Decoration.none;

        return Decoration.set([
            Decoration.widget({
                widget: new GhostTextWidget(suggestion.text),
                side: 1
            }).range(suggestion.pos)
        ]);
    }
);
```

The ghost text appears as a semi-transparent widget after the cursor. Pressing Tab accepts it (by dispatching a transaction that inserts the suggestion text into the document). Pressing Escape or continuing to type clears it.

### The Suggestion Lifecycle

```
User pauses typing (500ms debounce)
    │
    ▼
Frontend sends context to Rust via invoke():
    ├── Current file content (or relevant portion)
    ├── Cursor position
    ├── File path
    │
    ▼
Rust forwards to Python sidecar with enriched context:
    ├── Code around cursor
    ├── Session state (blockers, next steps)
    ├── Relevant knowledge graph entities
    ├── Function signature and docstring from tree-sitter
    │
    ▼
Python calls LLM via model router (task_type: "completion")
    │
    ▼
LLM generates completion tokens
    │
    ▼
Response sent back: Rust → Tauri event → Frontend
    │
    ▼
Frontend dispatches setSuggestion effect → state field updates → decoration appears
    │
    ├── User presses Tab → insert suggestion text as a transaction
    ├── User presses Escape → dispatch clearSuggestion effect
    └── User keeps typing → docChanged triggers state field to clear
```

---

## 6. The Document Model: Ropes

### Why Not Just a String?

A naive editor stores the document as a single string. Inserting text at position 500 in a 100,000-character string requires copying 99,500 characters. For a fast typist making 5 edits per second, this adds up.

### Rope Data Structure

CodeMirror 6 uses a **rope** — a tree where each leaf holds a small chunk of text (a few hundred characters). Inserting or deleting text only requires modifying the leaves near the edit point and rebalancing the tree.

```
              [root]
             /      \
          [node]    [node]
          /    \      |
    "import t" "orch\nimport " "torch.nn as nn\n"
```

Inserting at position 15 only modifies the leaf containing that position. All other leaves are shared between the old and new document (structural sharing, enabled by immutability).

**Performance characteristics:**

| Operation | String | Rope |
|-----------|--------|------|
| Insert at position | O(n) copy | O(log n) tree update |
| Delete range | O(n) copy | O(log n) tree update |
| Read character at position | O(1) | O(log n) tree walk |
| Get full text | O(1) (it's already a string) | O(n) concatenation |

For editing (insert/delete), ropes are much faster. For reading, strings are faster. Since editing happens at typing speed (frequent) and full text reads happen less often (save, send to LSP), the rope trade-off is worth it.

---

## 7. View Plugins vs. State Fields

CodeMirror 6 provides two mechanisms for extending the editor, and choosing between them matters:

### State Fields

- Stored as part of `EditorState` (immutable)
- Updated synchronously with transactions
- Survive editor recreation (can serialize/deserialize state)
- Best for: data that's part of the document's logical state (annotations, diagnostics, bookmarks)

### View Plugins

- Attached to `EditorView` (the DOM representation)
- Can access the DOM, measure element sizes, schedule animations
- Destroyed and recreated when the view is reconfigured
- Best for: visual effects, DOM interaction, viewport-dependent behavior

**Rule of thumb:** If a feature depends on what's visible on screen (viewport-aware decorations, scroll-based loading), use a view plugin. If it depends on the document content regardless of what's visible (annotations, error markers), use a state field.

For this project:
- **Semantic annotations** → State field (annotations are part of the logical document state)
- **Ghost text rendering** → State field + decoration (suggestion is logical state; rendering is visual)
- **Viewport-optimized decorations** → View plugin (only compute decorations for visible lines)
- **Scroll-triggered context loading** → View plugin (needs to know what's in the viewport)

---

## 8. Keymaps and Input Handling

### Keymap Extensions

CodeMirror keymaps map key combinations to commands:

```typescript
import { keymap } from "@codemirror/view";

const customKeymap = keymap.of([
    {
        key: "Tab",
        run(view) {
            // Accept AI suggestion if one is showing
            const suggestion = view.state.field(suggestionField);
            if (suggestion) {
                view.dispatch({
                    changes: { from: suggestion.pos, insert: suggestion.text },
                    effects: clearSuggestion.of(null)
                });
                return true;  // Handled
            }
            return false;  // Not handled, let other keymaps try
        }
    },
    {
        key: "Mod-Shift-r",  // Cmd+Shift+R on Mac, Ctrl+Shift+R on Linux/Windows
        run(view) {
            openRefactoringPanel(view);
            return true;
        }
    }
]);
```

`Mod` automatically maps to Cmd on macOS and Ctrl on Windows/Linux. Keymaps are checked in order — the first handler that returns `true` wins.

### Input Rules

Input rules transform text as you type:

```typescript
import { inputRule } from "@codemirror/autocomplete";

// Auto-close brackets
const bracketRule = inputRule({
    match: /\($/,
    apply: (state, match, start, end) => {
        return state.update({
            changes: { from: end, insert: ")" },
            selection: { anchor: end }  // Keep cursor between brackets
        });
    }
});
```

---

## 9. Performance: Viewport-Aware Rendering

### The Problem

A file might have 10,000 lines, but only ~50 are visible at any time. Computing decorations (syntax highlighting, annotations) for all 10,000 lines on every keystroke would be wasteful.

### Viewport Restriction

CodeMirror 6 only renders lines in the **viewport** (the visible area plus a small buffer above and below). View plugins can access `view.viewport` to know which lines are visible:

```typescript
const efficientAnnotations = ViewPlugin.define(view => {
    return {
        decorations: computeForViewport(view),
        update(update) {
            if (update.viewportChanged || update.docChanged) {
                this.decorations = computeForViewport(update.view);
            }
        }
    };
});

function computeForViewport(view: EditorView) {
    const { from, to } = view.viewport;
    // Only query entities for lines in the visible range
    const entities = queryEntitiesInRange(view.state.doc, from, to);
    // Build decorations only for visible entities
    return buildDecorations(entities);
}
```

When the user scrolls, `viewportChanged` fires and decorations are recomputed for the new visible range. This keeps the editor fast even for very large files.

---

## Key Takeaways

1. **State is immutable.** All changes go through transactions. This prevents extensions from conflicting and enables clean undo/redo.

2. **Extensions compose declaratively.** Multiple extensions (syntax highlighting, annotations, AI suggestions, bracket matching) all provide decorations and state fields that the editor merges automatically.

3. **Decorations add visuals without changing content.** Mark decorations style ranges. Widget decorations insert elements. Both are the mechanism for semantic annotations and ghost text.

4. **Facets combine contributions from multiple extensions.** The autocomplete system merges suggestions from LSP, AI, and the context engine through facets.

5. **Ropes make editing fast.** The document is a tree, not a string. Insertions and deletions are O(log n) instead of O(n).

6. **Viewport awareness keeps performance high.** Only compute decorations for visible lines. Recompute on scroll. Large files stay fast.

7. **State fields for data, view plugins for DOM.** Choose based on whether the feature is about document state or visual presentation.

---

## Further Reading

- [CodeMirror 6 System Guide](https://codemirror.net/docs/guide/) — Official architecture documentation
- [CodeMirror 6 Reference Manual](https://codemirror.net/docs/ref/) — Complete API reference
- [Writing CodeMirror Extensions](https://codemirror.net/examples/) — Worked examples of custom extensions
- [The Rope Data Structure](https://en.wikipedia.org/wiki/Rope_(data_structure)) — How ropes enable fast text editing
- [CodeMirror 6 Decoration Example](https://codemirror.net/examples/decoration/) — How decorations work in practice

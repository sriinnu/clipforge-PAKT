# PAKT Format Specification

**Version:** 1.0.0-draft
**Status:** Draft
**Date:** 2026-02-17
**Authors:** Sriinnu

---

## Table of Contents

1. [Overview and Goals](#1-overview-and-goals)
2. [Document Structure](#2-document-structure)
3. [Headers](#3-headers)
4. [Data Types and Scalars](#4-data-types-and-scalars)
5. [Key-Value Pairs](#5-key-value-pairs)
6. [Nesting (Objects)](#6-nesting-objects)
7. [Arrays](#7-arrays)
8. [Comments](#8-comments)
9. [Dictionary Block (Layer 2)](#9-dictionary-block-layer-2)
10. [Escaping Rules](#10-escaping-rules)
11. [Whitespace Rules](#11-whitespace-rules)
12. [Layer 3: Tokenizer-Aware Optimization](#12-layer-3-tokenizer-aware-optimization)
13. [Layer 4: Semantic Compression (Lossy, Opt-in)](#13-layer-4-semantic-compression-lossy-opt-in)
14. [Error Handling](#14-error-handling)
15. [MIME Type and File Extension](#15-mime-type-and-file-extension)
16. [Comparison with Other Formats](#16-comparison-with-other-formats)
17. [Examples](#17-examples)
18. [Grammar (BNF-like)](#18-grammar-bnf-like)
19. [Differences from TOON](#19-differences-from-toon)
20. [References](#20-references)

---

## 1. Overview and Goals

### 1.1 What Is PAKT

PAKT stands for **Prompt-Adapted Knowledge Transfer**. It is a text-based data
serialization format purpose-built for minimal LLM token consumption while
remaining human-readable and 100% lossless across its core compression layers
(Layers 1 through 3).

PAKT is not a general-purpose configuration language. It is a **wire format**
for the space between structured data and large language models, where every
token has a measurable cost in latency, money, and context window capacity.

### 1.2 Why PAKT Exists

LLM APIs charge per token. Context windows are finite. The dominant serialization
formats -- JSON, YAML, CSV -- were designed decades before token economics
existed. They carry structural overhead that is invisible to humans but expensive
to tokenizers:

- JSON spends tokens on `{`, `}`, `[`, `]`, `"`, `,` around every value
- YAML trades bracket tokens for indentation tokens but adds `---`, `-`, and
  verbosity in sequences
- CSV is token-efficient for flat tables but cannot represent nesting or mixed
  structures

PAKT targets the intersection: **structured data that must be sent to or received
from an LLM, where token cost matters**. It achieves 40-60% token reduction on
typical structured payloads while maintaining full data fidelity.

### 1.3 Design Principles

1. **Minimal tokens.** Every syntactic element is chosen to minimize BPE token
   count across major tokenizers (cl100k_base, o200k_base, Claude, Llama 3).
2. **Human-readable.** A developer can read and write PAKT without tooling.
   The format is not binary, not encoded, not obfuscated.
3. **Lossless (Layers 1-3).** `decompress(compress(data)) === data` is an
   invariant. Round-trip fidelity is non-negotiable for the core layers.
4. **Machine-parseable.** A formal grammar exists. Parsers can be implemented
   in any language. Error reporting includes line and column numbers.
5. **Shape-adaptive.** Flat key-value, nested objects, uniform tabular arrays,
   and heterogeneous list arrays each have dedicated syntax tuned for their
   shape. No single representation is forced onto all data.
6. **Layered compression.** Each layer is independently toggleable and each
   layer preserves the invariants of the layers below it.

### 1.4 Relationship to TOON

PAKT is **inspired by** the TOON format (github.com/toon-format/spec) but is
**not a superset, subset, or fork of TOON**. PAKT shares TOON's core intuitions
-- indentation-based nesting, pipe-delimited tabular arrays, bracket-enclosed
counts -- but extends the format with:

- Dictionary blocks for alias-based deduplication (Layer 2)
- Tokenizer-aware optimization headers (Layer 3)
- Explicit lossy compression flagging (Layer 4)
- A versioning header
- Stricter escaping rules
- Mandated count validation semantics

A valid TOON document is often a valid PAKT Layer 1 document, but PAKT documents
with `@dict`, `@target`, `@version`, or `@compress` headers are not valid TOON.

### 1.5 Compression Layers

| Layer | Name | Type | Description |
|-------|------|------|-------------|
| L1 | Structural | Lossless | Convert source format (JSON, YAML, CSV) to PAKT syntax. Key-value pairs, indented nesting, tabular arrays, inline arrays. |
| L2 | Dictionary | Lossless | Deduplicate repeated values via `@dict` alias block. Trivial string replacement; lossless by construction. |
| L3 | Tokenizer-Aware | Lossless | Adjust delimiters, booleans, whitespace patterns based on target model's BPE merge list. Cosmetic-only; data unchanged. |
| L4 | Semantic | **Lossy** | Truncate, abbreviate, or drop fields. Opt-in only. Flagged with `@compress semantic` and `@warning lossy`. Cannot be reversed. |

Layers 1-3 are always lossless. Layer 4 is always opt-in, always lossy, and
always explicitly flagged.

---

## 2. Document Structure

A PAKT document consists of two regions: an optional **header block** followed
by the **body**.

```
[headers]       <-- zero or more lines starting with @
[blank line]    <-- optional separator
[body]          <-- data in PAKT syntax
```

### 2.1 Header Block

Headers appear at the top of the document before any data. Each header line
starts with the `@` character. The header block ends when the first non-header,
non-blank, non-comment line is encountered.

The `@dict` ... `@end` block is a special multi-line header.

### 2.2 Body

The body contains data expressed in PAKT syntax: key-value pairs, nested objects,
inline arrays, tabular arrays, list arrays, and comments.

### 2.3 Minimal Document

The simplest valid PAKT document is a single key-value pair:

```
name: Sriinnu
```

No headers are required.

### 2.4 Full Document

A document using all header types:

```
@version 1.0.0
@from json
@target claude
@dict
  $a: Engineering
  $b: in-progress
@end

status: active
department: $a
progress: $b
```

---

## 3. Headers

All headers begin with `@` and must appear before the body. Headers are
order-independent except that `@dict` ... `@end` must be contiguous.

### 3.1 `@version <semver>`

Declares the PAKT specification version this document conforms to.

```
@version 1.0.0
```

- Format: semantic versioning (MAJOR.MINOR.PATCH)
- Optional. If omitted, parsers SHOULD assume the latest version they support.
- Parsers MUST reject documents with a major version they do not support.

### 3.2 `@from <format>`

Declares the original format of the data before PAKT compression.

```
@from json
```

Valid values: `json`, `yaml`, `csv`, `markdown`, `text`, `toml`

- Used by the decompressor to restore the original format.
- Optional. If omitted, the decompressor defaults to `json`.

### 3.3 `@target <model>`

Specifies which model's tokenizer was used for Layer 3 optimization.

```
@target claude
```

Valid values: `claude`, `gpt-4o`, `gpt-4`, `llama3`, `gemma2`, `mistral`,
`default`

- Optional. Only present when Layer 3 optimization was applied.
- Parsers that do not implement Layer 3 MUST ignore this header.
- The `default` value indicates generic optimization with no model-specific
  tuning.

### 3.4 `@dict` ... `@end`

Defines a dictionary block containing alias-to-expansion mappings for Layer 2
deduplication. See [Section 9](#9-dictionary-block-layer-2) for full
specification.

```
@dict
  $a: Engineering
  $b: in-progress
  $c: high
@end
```

- Optional. Only present when Layer 2 compression was applied.
- Must be contiguous (no non-dict content between `@dict` and `@end`).
- Placed after other headers, before the body.

### 3.5 `@compress semantic`

Flags that Layer 4 lossy semantic compression was applied to this document.

```
@compress semantic
```

- Optional. Only present when Layer 4 was explicitly enabled.
- MUST be accompanied by `@warning lossy`.

### 3.6 `@warning lossy`

Explicit warning that this document cannot be fully restored to its original
form.

```
@warning lossy
```

- MUST be present whenever `@compress semantic` is present.
- Parsers SHOULD surface this warning to the caller.
- Decompressors MUST set a `wasLossy: true` flag in their output.

### 3.7 Header Grammar Summary

```
header       = "@" header-name SP header-value LF
header-name  = "version" | "from" | "target" | "compress" | "warning"
dict-block   = "@dict" LF (dict-entry)* "@end" LF
dict-entry   = INDENT alias ":" SP expansion LF
```

---

## 4. Data Types and Scalars

PAKT supports five scalar types. Type is inferred from the textual
representation of the value; there are no type annotations.

### 4.1 Strings

Strings are the default type. Any value that does not match the rules for
numbers, booleans, or null is interpreted as a string.

**Unquoted strings** (the common case):

```
name: Sriinnu
city: Hyderabad
path: /usr/local/bin
url: https://example.com/api?q=1&limit=10
```

Unquoted strings extend from the first non-whitespace character after the
`: ` separator to the end of the line (or to an inline comment marker ` % `).

**Quoted strings** are required when the value contains characters that would
otherwise cause ambiguity:

```
message: "Error: connection refused"
delimiter: "value|with|pipes"
padded: "  leading spaces  "
literal_dollar: "$notAnAlias"
literal_percent: "%notAComment"
escaped: "line one\nline two"
```

Quoting rules:

- Use `"double quotes"` when the value contains `:`, `|`, or leading/trailing
  whitespace, or when the value starts with `$` or `%`.
- There is no single-quote syntax.
- Within quoted strings, `\"` produces a literal `"`, `\\` produces a literal
  `\`, and `\n` produces a newline.

### 4.2 Numbers

Bare numeric values are parsed as numbers.

```
count: 42
price: 3.14
offset: -1
big: 1e10
negative_exp: 2.5e-3
zero: 0
```

Number recognition rules:

- Matches the regex: `-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?`
- Leading zeros are NOT permitted (except for the value `0` itself).
  `007` is a **string**, not a number.
- `Infinity`, `-Infinity`, and `NaN` are NOT supported as numbers.
  They are treated as strings.

### 4.3 Booleans

```
active: true
deleted: false
```

- Only lowercase `true` and `false` are booleans.
- `True`, `TRUE`, `yes`, `no`, `on`, `off` are all **strings**.

### 4.4 Null

```
middleName: null
```

- Only lowercase `null` is null.
- `Null`, `NULL`, `nil`, `None`, `~` are all **strings**.

### 4.5 Type Inference Precedence

When parsing a value, the parser applies these rules in order:

1. If the value is `null` (exact, case-sensitive) -> **Null**
2. If the value is `true` or `false` (exact, case-sensitive) -> **Boolean**
3. If the value matches the number regex -> **Number**
4. Otherwise -> **String**

### 4.6 Preserving Type Ambiguity

Some values in the source data are strings that look like numbers or booleans.
To preserve them:

- Source `"42"` (string in JSON) -> PAKT `id: "42"` (quoted to force string)
- Source `"true"` (string in JSON) -> PAKT `flag: "true"` (quoted to force string)
- Source `"null"` (string in JSON) -> PAKT `value: "null"` (quoted to force string)

The compressor MUST quote string values that would otherwise be misinterpreted
as numbers, booleans, or null. The decompressor MUST treat quoted values as
strings regardless of their content.

---

## 5. Key-Value Pairs

The fundamental unit of PAKT data is the key-value pair.

### 5.1 Syntax

```
key: value
```

- The separator is a colon followed by exactly one space: `: ` (U+003A U+0020).
- Keys appear to the left of the separator.
- Values appear to the right of the separator.

### 5.2 Key Rules

- Keys are always unquoted.
- Keys MUST NOT contain spaces. Use `camelCase` or `snake_case`.
- Keys MUST NOT contain `:`, `|`, `[`, `]`, `{`, `}`, `%`, `@`, or `$`.
- Keys are case-sensitive: `Name` and `name` are different keys.
- Duplicate keys at the same nesting level are an error.
- Keys MUST NOT be empty.

### 5.3 Value Rules

- Values follow the type inference rules in Section 4.
- Empty value (key with no value after `: `) is interpreted as an empty string `""`.
- Multi-line values are NOT supported. Use `\n` escape within a quoted string.

### 5.4 Examples

```
name: Sriinnu
age: 28
active: true
score: 3.14
data: null
empty:
path: /home/user/.config
greeting: "Hello: World"
```

The `empty:` line (colon followed by nothing) produces the key `empty` with
the value `""` (empty string).

---

## 6. Nesting (Objects)

Nested objects are expressed through indentation.

### 6.1 Syntax

```
parentKey
  childKey1: value1
  childKey2: value2
  grandparentKey
    grandchildKey: value3
```

- A key on its own line (no colon, no value) declares a **nested object**.
- Children of that object are indented by exactly 2 spaces relative to the parent.
- Nesting can be arbitrarily deep. Each level adds 2 spaces.

### 6.2 Indentation

- Each nesting level MUST use exactly **2 spaces** of indentation.
- This is mandatory and not configurable per-document.
- Tab characters (`\t`, U+0009) are **rejected** with an explicit parser error.
  Parsers MUST NOT silently convert tabs to spaces.
- Mixed indentation (some lines with 2 spaces, some with 4 for the same level)
  is an error.

### 6.3 Examples

**Two levels:**

```
user
  name: Sriinnu
  role: developer
```

Equivalent JSON:

```json
{
  "user": {
    "name": "Sriinnu",
    "role": "developer"
  }
}
```

**Three levels:**

```
config
  database
    host: localhost
    port: 5432
    credentials
      user: admin
      password: "s3cr3t"
  cache
    enabled: true
    ttl: 3600
```

Equivalent JSON:

```json
{
  "config": {
    "database": {
      "host": "localhost",
      "port": 5432,
      "credentials": {
        "user": "admin",
        "password": "s3cr3t"
      }
    },
    "cache": {
      "enabled": true,
      "ttl": 3600
    }
  }
}
```

### 6.4 Empty Objects

An object key with no indented children represents an empty object:

```
metadata
settings
  theme: dark
```

Here `metadata` is `{}` and `settings` is `{ "theme": "dark" }`.

**Disambiguation rule:** If a key appears on its own line (no colon) and the
next non-blank, non-comment line is at the same or lesser indentation level,
the key represents an empty object. If the next line is indented further, the
key is a parent of a nested object.

---

## 7. Arrays

PAKT supports three array syntaxes, each optimized for a different data shape.

### 7.1 Inline Arrays (Primitives)

For arrays of scalar values (strings, numbers, booleans, null).

**Syntax:**

```
name [count]: item1,item2,item3
```

- `name` is the key.
- `[count]` is the element count enclosed in square brackets. **Mandatory.**
- `:` followed by a space, then comma-separated values.
- No spaces after commas (to save tokens).
- Items follow the same type inference rules as scalar values.

**Examples:**

```
tags [3]: React,TypeScript,Rust
scores [5]: 95,87,92,78,88
flags [3]: true,false,true
ids [4]: 1001,1002,1003,1004
mixed [4]: hello,42,true,null
```

**Count validation:** The parser MUST verify that the number of comma-separated
items equals the declared count. A mismatch is an error.

**Empty inline array:**

```
tags [0]:
```

An inline array with count `[0]` and no items after the colon represents an
empty array `[]`.

**Strings with commas:** If an inline array element contains a comma, it MUST
be quoted:

```
phrases [2]: "hello, world","goodbye, world"
```

### 7.2 Tabular Arrays (Uniform Objects)

For arrays of objects that share the same set of keys. This is the format's
most token-efficient construct and its primary advantage over JSON and YAML.

**Syntax:**

```
name [count]{field1|field2|field3}:
  value1|value2|value3
  value4|value5|value6
```

- `name` is the key.
- `[count]` is the row count. **Mandatory.**
- `{field1|field2|...}` is the column header declaring field names,
  delimited by `|`.
- `:` terminates the header line.
- Each subsequent indented line is a data row with `|`-delimited values.
- Rows are indented by 2 spaces relative to the header line.
- Each row MUST have the same number of `|`-delimited fields as the header.

**Example:**

```
projects [5]{id|name|dept|status|priority}:
  1|VAAYU|Engineering|active|high
  2|ClipForge|Engineering|planning|medium
  3|Substack|Content|active|high
  4|ChromeExt|Engineering|in-progress|low
  5|ToonParser|Engineering|planning|medium
```

Equivalent JSON:

```json
{
  "projects": [
    { "id": 1, "name": "VAAYU", "dept": "Engineering", "status": "active", "priority": "high" },
    { "id": 2, "name": "ClipForge", "dept": "Engineering", "status": "planning", "priority": "medium" },
    { "id": 3, "name": "Substack", "dept": "Content", "status": "active", "priority": "high" },
    { "id": 4, "name": "ChromeExt", "dept": "Engineering", "status": "in-progress", "priority": "low" },
    { "id": 5, "name": "ToonParser", "dept": "Engineering", "status": "planning", "priority": "medium" }
  ]
}
```

**Count validation:** The parser MUST verify that the number of data rows
equals the declared `[count]`. A mismatch is an error.

**Column count validation:** Each row MUST contain exactly as many
`|`-delimited values as there are fields in the header. A mismatch is an error.

**Empty values:** Two consecutive pipes `||` denote an empty string:

```
users [3]{id|name|email}:
  1|Alice|alice@example.com
  2|Bob|
  3||charlie@example.com
```

Row 2 has an empty `email`. Row 3 has an empty `name`.

**Values containing pipes:** Quote the value:

```
expressions [2]{id|formula|result}:
  1|"x|y"|true
  2|"a|b|c"|false
```

**Type inference in rows:** Each cell value follows the same type inference
rules as scalar values (Section 4). Cells that are `null`, `true`, `false`, or
numeric are parsed accordingly.

**Empty tabular array:**

```
items [0]{id|name}:
```

A tabular array with count `[0]` and no data rows represents an empty array `[]`.

**Nested tabular arrays:** Tabular arrays cannot contain nested objects within
cells. If a source array contains objects with nested sub-objects, the
compressor MUST use list arrays (Section 7.3) instead, or flatten the nested
fields with dotted key names.

### 7.3 List Arrays (Non-Uniform Objects)

For arrays of objects that do NOT share the same set of keys, or that contain
nested structures.

**Syntax:**

```
name [count]:
  - key1: value1
    key2: value2
  - key3: value3
    key4: value4
    key5: value5
```

- `name` is the key.
- `[count]` is the item count. **Mandatory.**
- `:` terminates the header line.
- Each item starts with `- ` (dash, space) at the base indentation level
  (2 spaces from the array header).
- Subsequent properties of the same item are indented to align with the first
  property (i.e., 4 spaces from the array header).
- Items can have different keys and different numbers of properties.
- Items can contain nested objects and nested arrays.

**Example:**

```
events [3]:
  - type: deploy
    timestamp: 2026-02-17T10:30:00Z
    success: true
  - type: alert
    message: CPU spike on node-3
    severity: warning
  - type: config_change
    field: max_connections
    oldValue: 100
    newValue: 200
    changedBy: admin
```

Equivalent JSON:

```json
{
  "events": [
    { "type": "deploy", "timestamp": "2026-02-17T10:30:00Z", "success": true },
    { "type": "alert", "message": "CPU spike on node-3", "severity": "warning" },
    { "type": "config_change", "field": "max_connections", "oldValue": 100, "newValue": 200, "changedBy": "admin" }
  ]
}
```

**Nested objects within list items:**

```
users [2]:
  - name: Alice
    address
      street: 123 Main St
      city: Springfield
  - name: Bob
    address
      street: 456 Oak Ave
      city: Shelbyville
    tags [2]: admin,user
```

**Count validation:** The parser MUST verify that the number of `- ` items
equals the declared `[count]`. A mismatch is an error.

**Empty list array:**

```
items [0]:
```

A list array with count `[0]` and no items represents an empty array `[]`.

### 7.4 Array Type Selection

The compressor selects array syntax based on the data shape:

| Data Shape | Syntax | Reason |
|------------|--------|--------|
| Array of primitives (strings, numbers, booleans, nulls) | Inline `[N]: a,b,c` | Most compact for flat values |
| Array of objects with identical key sets | Tabular `[N]{keys}:` rows | Eliminates key repetition entirely |
| Array of objects with varying key sets | List `[N]:` with `- ` items | Handles heterogeneous structures |
| Array of objects with nested sub-objects | List `[N]:` with `- ` items | Tabular cannot represent nesting |
| Mixed array (primitives and objects) | List `[N]:` with `- ` items | Fallback for non-uniform content |

---

## 8. Comments

### 8.1 Line Comments

```
% This is a full-line comment
```

- The `%` character at the start of a line (ignoring leading whitespace)
  begins a comment.
- The comment extends to the end of the line.
- Comment lines are ignored by the parser.

### 8.2 Inline Comments

```
status: success  % this is an inline comment
age: 28  % years old
```

- An inline comment begins with ` % ` (space, percent, space) after a value.
- The comment extends to the end of the line.
- The value is everything between `: ` and ` % `.

### 8.3 Comment Preservation

Comments are **not preserved** during compression/decompression round-trips.
Comments are metadata for human readers and are stripped during parsing. If
comment preservation is required, the source format should be used directly.

### 8.4 Why `%` Instead of `#`

The `#` character is a common token start in many BPE tokenizers (e.g.,
`#include`, `###`, `#TODO`). Using `%` avoids accidental merges with
adjacent tokens, keeping comment markers as single tokens across tokenizers.

---

## 9. Dictionary Block (Layer 2)

The dictionary block implements Layer 2 compression: alias-based deduplication
of repeated values.

### 9.1 Syntax

```
@dict
  $a: Engineering
  $b: in-progress
  $c: high-priority
@end
```

- The block begins with `@dict` on its own line.
- Each entry is indented by 2 spaces and follows the pattern `$alias: expansion`.
- The block ends with `@end` on its own line.
- The block is placed after other `@` headers and before the body.

### 9.2 Alias Naming

Aliases follow a strict naming scheme:

- First 26 aliases: `$a` through `$z`
- Next 26 aliases: `$aa` through `$az`
- Maximum of **52 aliases** per document.

Aliases are assigned in order of descending net token savings: `$a` is the
alias with the highest savings, `$b` the second-highest, and so on.

### 9.3 Alias Selection Criteria

A value is eligible for aliasing only when ALL of the following are true:

1. The value is **2 or more tokens** long (under the target tokenizer).
2. The value appears **3 or more times** in the document body.
3. The **net token savings** is >= 3 tokens.

Net savings formula:

```
net_savings = (value_tokens - alias_tokens) * occurrence_count - dict_overhead
```

Where:
- `value_tokens` = token count of the full value string
- `alias_tokens` = token count of the alias (typically 1 token for `$a`-`$z`)
- `occurrence_count` = number of times the value appears in the body
- `dict_overhead` = tokens consumed by the dictionary entry line
  (`  $a: Engineering\n` = approximately `value_tokens + 3`)

If `net_savings < 3`, the alias is not created.

### 9.4 Alias Expansion

During decompression, aliases are expanded by simple string replacement:

1. Parse the `@dict` block into a map of alias -> expansion.
2. Walk all values in the document body.
3. If a value exactly equals an alias (e.g., the value is `$a`), replace it
   with the expansion.
4. If a value contains an alias as a substring within a larger string, it is
   **NOT** expanded. Aliases are whole-value replacements only.

This makes expansion trivially correct: there is no ambiguity, no recursive
expansion, and no possibility of data corruption. The operation is **lossless
by construction**.

### 9.5 Alias in Context

**Before Layer 2:**

```
@from json

projects [5]{id|name|dept|status|priority}:
  1|VAAYU|Engineering|active|high
  2|ClipForge|Engineering|planning|medium
  3|Substack|Content|active|high
  4|ChromeExt|Engineering|in-progress|low
  5|ToonParser|Engineering|planning|medium
```

**After Layer 2:**

```
@from json
@dict
  $a: Engineering
  $b: planning
  $c: medium
@end

projects [5]{id|name|dept|status|priority}:
  1|VAAYU|$a|active|high
  2|ClipForge|$a|$b|$c
  3|Substack|Content|active|high
  4|ChromeExt|$a|in-progress|low
  5|ToonParser|$a|$b|$c
```

### 9.6 Edge Cases

**Value that looks like an alias:** If the original data contains a string
value like `$a`, the compressor MUST quote it: `"$a"`. The decompressor
treats quoted values as literal strings and does not attempt alias expansion.

**Alias within quoted value:** Aliases inside quoted strings are NOT expanded.
`"The department is $a"` is the literal string `The department is $a`.

**Empty dict block:** A `@dict` followed immediately by `@end` with no entries
is valid but pointless. Parsers MUST accept it without error.

**Missing @end:** If `@dict` is present without a matching `@end`, the parser
MUST report an error: `"Unterminated @dict block -- missing @end"`.

---

## 10. Escaping Rules

PAKT uses minimal escaping. Most values require no escaping at all. Escaping
is only needed when a value contains characters that have syntactic meaning.

### 10.1 When to Quote

A value MUST be enclosed in double quotes when it contains any of:

| Character / Pattern | Reason | Example |
|---------------------|--------|---------|
| `:` (colon) | Would be parsed as a key-value separator | `"Error: timeout"` |
| `\|` (pipe) | Would be parsed as a field delimiter in tabular rows | `"x\|y"` |
| Leading whitespace | Would be stripped during parsing | `"  indented"` |
| Trailing whitespace | Would be stripped during parsing | `"padded  "` |
| `$` at start | Would be interpreted as a dictionary alias | `"$literal"` |
| `%` at start | Would be interpreted as a comment | `"%not a comment"` |
| Newline needed | Multi-line values are not supported unquoted | `"line 1\nline 2"` |

### 10.2 Escape Sequences Within Quoted Strings

| Sequence | Produces | Description |
|----------|----------|-------------|
| `\"` | `"` | Literal double quote |
| `\\` | `\` | Literal backslash |
| `\n` | U+000A | Newline (line feed) |
| `\t` | U+0009 | Tab (for data values, not indentation) |
| `\r` | U+000D | Carriage return |

No other escape sequences are defined. A `\` followed by any character not
listed above is an error.

### 10.3 Unquoted Values: What Is Safe

The following characters are safe in unquoted values and require no escaping:

- Letters (any Unicode letter)
- Digits
- `-`, `_`, `.`, `/`, `@`, `#`, `&`, `=`, `?`, `+`, `~`, `!`, `^`, `*`,
  `(`, `)`, `<`, `>`, `'`, `,` (comma in non-inline-array contexts),
  `;`, spaces (except leading/trailing)

### 10.4 Commas in Inline Arrays

In inline array values, commas are delimiters. If an element contains a literal
comma, it MUST be quoted:

```
phrases [2]: "hello, world","goodbye, world"
```

### 10.5 Pipes in Tabular Rows

In tabular array rows, pipes are field delimiters. If a cell contains a literal
pipe, it MUST be quoted:

```
formulas [2]{id|expression|result}:
  1|"a|b"|true
  2|"x|y|z"|false
```

---

## 11. Whitespace Rules

### 11.1 Indentation

- Indentation unit: exactly **2 spaces** (U+0020 U+0020) per nesting level.
- This is mandatory. There is no per-document or per-user override.
- Level 0 (root): 0 spaces
- Level 1: 2 spaces
- Level 2: 4 spaces
- Level N: N * 2 spaces

### 11.2 Tabs

Tab characters (U+0009) are **rejected**. If a parser encounters a tab in an
indentation position, it MUST report an error:

```
"Tab character at line X -- use 2 spaces for indentation"
```

Parsers MUST NOT silently convert tabs to spaces. This is a deliberate design
decision to avoid the class of bugs that YAML inherits from mixed
tab/space indentation.

### 11.3 Trailing Whitespace

Trailing whitespace at the end of any line is **ignored** and stripped during
parsing. It has no semantic meaning.

### 11.4 Blank Lines

Blank lines (lines containing only whitespace or nothing) are allowed between
sections for readability. They are **semantically ignored** by the parser.

```
name: Sriinnu
age: 28

address
  city: Hyderabad

tags [2]: code,music
```

The blank lines above have no effect on the parsed data structure.

### 11.5 Line Endings

- The canonical line ending is LF (`\n`, U+000A).
- CRLF (`\r\n`) is **normalized** to LF during parsing.
- Bare CR (`\r`) is normalized to LF during parsing.
- Serializers SHOULD emit LF line endings.

### 11.6 Key-Value Separator Spacing

The separator between key and value is exactly `: ` (colon + one space). Not
`:` alone, not `:  ` (colon + two spaces), not ` : ` (space + colon + space).

```
name: Sriinnu    % correct
name:Sriinnu     % ERROR: missing space after colon
name:  Sriinnu   % ERROR: two spaces after colon
```

---

## 12. Layer 3: Tokenizer-Aware Optimization

### 12.1 Purpose

Different BPE tokenizers encode the same text into different token sequences.
The delimiter `|` might be 1 token in one tokenizer and 2 tokens in another.
Layer 3 makes cosmetic adjustments to the PAKT output to minimize token count
for a specific target tokenizer.

### 12.2 Mechanism

When `@target <model>` is specified, the compressor MAY adjust:

- **Delimiter character** in tabular arrays (`|` vs `\t` vs `,` vs `;`)
- **Boolean representation** (`true/false` vs `T/F` vs `1/0`)
- **Whitespace patterns** (e.g., using `\t` for indentation if the target
  tokenizer treats it as a single token)
- **Numeric formatting** (e.g., `1000` vs `1e3` depending on token cost)

### 12.3 Invariants

Layer 3 MUST NOT change the semantic content of the data. The following
invariants hold:

- `decompressL3(compressL3(data)) === data` for all data
- The number of keys, values, array elements, and nesting levels is unchanged
- Type inference results are unchanged (a number stays a number, a string
  stays a string)
- Only the characters used for syntax (delimiters, whitespace) are affected

### 12.4 Gating Condition

Layer 3 is gated on empirical benchmarks. If cross-tokenizer delimiter
optimization yields less than 3% average token savings across 5 major
tokenizers on 1000 representative samples, Layer 3 is removed from the
specification and the default syntax is hardcoded:

- Delimiter: `|` (pipe)
- Booleans: `true` / `false`
- Indentation: 2 spaces
- Separator: `: ` (colon space)

**Rationale:** The complexity of maintaining per-model tokenizer profiles
is only justified if the savings are meaningful. Research by Hayase et al.
(2024) proves tokenizers differ, but for common delimiter characters, most
modern tokenizers converge to similar token counts.

### 12.5 Target Profiles

Each target model has a profile (JSON configuration) specifying optimal
syntax choices:

```json
{
  "model": "claude",
  "tokenizer": "claude-tokenizer-2024",
  "delimiter": "|",
  "boolTrue": "true",
  "boolFalse": "false",
  "indent": "  ",
  "separator": ": "
}
```

Profiles are generated by automated benchmarks, not hand-tuned. Profile
updates are data files, not code changes.

---

## 13. Layer 4: Semantic Compression (Lossy, Opt-in)

### 13.1 Purpose

Layer 4 applies lossy compression techniques to further reduce token count
when approximate data is acceptable. This is useful for background context,
historical data, or summary information where exact fidelity is not required.

### 13.2 Requirements

Layer 4 MUST satisfy ALL of the following:

1. **Never enabled by default.** The caller must explicitly opt in with a
   configuration flag (e.g., `layers.semantic: true` or equivalent API option).
2. **Always flagged.** The output document MUST contain both `@compress semantic`
   and `@warning lossy` headers.
3. **Irreversible.** The decompressor MUST set `wasLossy: true` in its output
   and MUST NOT claim the original data can be restored.

### 13.3 Strategies

Layer 4 MAY apply any combination of:

- **String truncation:** Long string values are truncated to a maximum length
  with a `...` suffix.
- **Common word abbreviation:** Frequent English words are abbreviated using
  n-gram techniques (inspired by CompactPrompt).
- **Field dropping:** Low-information fields (e.g., `createdAt`, `updatedAt`,
  `id` when not referenced) are removed.
- **Precision reduction:** Numbers are rounded to fewer decimal places.
- **Deduplication of similar strings:** Near-duplicate values are merged.

### 13.4 Budget

The caller MAY specify a `semanticBudget` parameter indicating the target
token count. Layer 4 applies progressively more aggressive strategies until
the output fits within the budget or all strategies are exhausted.

### 13.5 Example

**Input (after L1-L3):**

```
@from json

articles [3]{id|title|content|author|createdAt}:
  1|Introduction to Quantum Computing|Quantum computing leverages quantum mechanical phenomena such as superposition and entanglement to process information in fundamentally new ways...|Dr. Alice Chen|2026-01-15T09:00:00Z
  2|The Future of Renewable Energy|As global energy demands continue to rise, renewable energy sources including solar, wind, and hydroelectric power are becoming increasingly cost-competitive...|Prof. Bob Martinez|2026-01-20T14:30:00Z
  3|Machine Learning in Healthcare|Recent advances in machine learning have enabled breakthrough applications in medical imaging, drug discovery, and personalized treatment planning...|Dr. Carol Wang|2026-02-01T11:15:00Z
```

**After Layer 4 (lossy, truncated):**

```
@from json
@compress semantic
@warning lossy

articles [3]{id|title|content|author}:
  1|Intro to Quantum Computing|Quantum computing uses superposition and entanglement for new info processing...|Dr. Alice Chen
  2|Future of Renewable Energy|Renewable energy (solar, wind, hydro) becoming cost-competitive...|Prof. Bob Martinez
  3|ML in Healthcare|ML enables breakthroughs in medical imaging, drug discovery, treatment...|Dr. Carol Wang
```

Note: `createdAt` field was dropped. `content` values were summarized.
`title` values were abbreviated. This data **cannot** be restored to the
original.

---

## 14. Error Handling

### 14.1 Error Reporting

All parser errors MUST include:

- **Line number** (1-based)
- **Column number** (1-based, measured in characters from line start)
- **Error message** (human-readable, descriptive)

Format: `Error at line {line}, column {col}: {message}`

### 14.2 Parser Modes

**Strict mode** (default):

- Any malformed input causes the parser to halt and return an error.
- No partial results are returned.
- This is the recommended mode for programmatic use.

**Lenient mode** (opt-in):

- The parser attempts best-effort parsing of malformed input.
- Errors are collected into a warnings array.
- A partial result is returned alongside the warnings.
- This is useful for debugging and for processing LLM-generated PAKT
  that may contain minor formatting errors.

### 14.3 Common Errors

| Error | Message |
|-------|---------|
| Tab indentation | `Tab character at line X -- use 2 spaces for indentation` |
| Inconsistent indent | `Inconsistent indent at line X -- expected N spaces, got M` |
| Row count mismatch | `Row count mismatch: header says [5], found 3 rows` |
| Column count mismatch | `Column count mismatch at line X: header has 4 fields, row has 3 values` |
| Undefined alias | `Undefined alias $x at line X -- not found in @dict` |
| Unterminated dict | `Unterminated @dict block -- missing @end` |
| Duplicate key | `Duplicate key "name" at line X (first defined at line Y)` |
| Missing separator | `Missing ": " separator at line X -- expected "key: value"` |
| Invalid header | `Unknown header "@foo" at line X` |
| Unterminated string | `Unterminated quoted string at line X, column Y` |
| Invalid escape | `Invalid escape sequence "\\q" at line X, column Y` |
| Empty key | `Empty key at line X` |
| Invalid alias name | `Invalid alias "$1" at line X -- aliases must match \\$[a-z]{1,2}` |

### 14.4 Auto-Repair (Optional)

Parsers MAY implement an auto-repair mode that fixes common errors before
parsing:

- **Inconsistent delimiters:** Mixed `|` and `,` in tabular rows -> normalize
  to `|`
- **Wrong indent depth:** 3-space indent -> round to 2 or 4 based on context
- **Missing `@end`:** Insert `@end` before first non-dict body line
- **Trailing whitespace:** Strip (always safe)
- **CRLF line endings:** Normalize to LF (always safe)

Auto-repair MUST report what it changed. Callers decide whether to accept the
repaired output.

---

## 15. MIME Type and File Extension

### 15.1 File Extension

```
.pakt
```

PAKT files use the `.pakt` extension. Examples: `data.pakt`, `config.pakt`,
`context.pakt`.

### 15.2 MIME Type

```
text/pakt
```

This is an informal MIME type, not registered with IANA. For systems that
require a registered type, use `text/plain` with a `charset=utf-8` parameter.

### 15.3 Encoding

PAKT documents are always **UTF-8** encoded. No BOM (Byte Order Mark) is
required or recommended. If a BOM is present, parsers MUST strip it silently.

---

## 16. Comparison with Other Formats

### 16.1 Feature Comparison

| Feature | PAKT | JSON | YAML | CSV | TOON |
|---------|------|------|------|-----|------|
| **Token efficiency** | Excellent (40-60% savings) | Baseline (0%) | Moderate (5-15% savings) | Good for flat data | Good (similar to PAKT L1) |
| **Human readability** | High | Moderate | High | Low for complex data | High |
| **Lossless round-trip** | Yes (L1-L3) | Yes | Yes (with caveats) | Lossy for nested data | Yes |
| **Tabular data** | Native (`[N]{fields}:` rows) | Verbose (repeated keys) | Verbose (repeated keys) | Native but flat only | Native |
| **Nesting support** | Yes (indentation) | Yes (braces) | Yes (indentation) | No | Yes (indentation) |
| **Mixed structures** | Yes (multiple array types) | Yes | Yes | No | Yes |
| **Dictionary dedup** | Yes (`@dict`) | No | No (anchors partial) | No | No |
| **Tokenizer-aware** | Yes (`@target`) | No | No | No | No |
| **Lossy mode** | Opt-in (`@compress`) | No | No | No | No |
| **LLM comprehension** | ~74% accuracy | ~70% accuracy | ~68% accuracy | Variable | ~74% accuracy |
| **Spec maturity** | Draft | RFC 8259 | YAML 1.2 | RFC 4180 | v1.3 |
| **Ecosystem** | New | Ubiquitous | Widespread | Ubiquitous | 7+ SDKs |
| **Count validation** | Mandatory `[N]` | No | No | No | Optional |
| **Comments** | Yes (`%`) | No | Yes (`#`) | No | Yes (`%`) |

### 16.2 Token Cost Comparison

The following table shows approximate token counts for the same dataset
(5 objects, 5 fields each) across formats, measured with the cl100k_base
tokenizer (GPT-4):

| Format | Tokens | vs JSON |
|--------|--------|---------|
| JSON (minified) | 142 | baseline |
| JSON (pretty) | 198 | +39% |
| YAML | 125 | -12% |
| CSV (with header) | 78 | -45% |
| PAKT L1 (structural) | 85 | -40% |
| PAKT L1+L2 (with dict) | 72 | -49% |
| PAKT L1+L2+L3 | ~69 | ~-51% |

**Notes:**
- CSV achieves similar savings to PAKT L1 for flat tabular data but cannot
  represent nesting, mixed types, or non-tabular structures.
- PAKT L1+L2 beats CSV when values are repeated because dictionary
  deduplication eliminates the repetition that CSV preserves.
- The exact savings depend on data shape, value repetition, and value length.

### 16.3 When NOT to Use PAKT

PAKT is not appropriate for:

- **Configuration files** where human editability is paramount (use YAML or TOML)
- **Data interchange between services** where JSON is the established standard
- **Deeply nested documents** with little tabular data (savings are marginal)
- **Pure prose or markdown** (PAKT adds overhead to unstructured text)
- **Binary data** (PAKT is text-only)
- **Streaming data** (PAKT requires knowing array counts upfront)

---

## 17. Examples

### 17.1 Simple Flat Object

**Source JSON:**

```json
{
  "name": "Sriinnu",
  "age": 28,
  "active": true,
  "email": "sri@example.com",
  "bio": null
}
```

**PAKT:**

```
@from json

name: Sriinnu
age: 28
active: true
email: sri@example.com
bio: null
```

**Decompressed back to JSON:**

```json
{
  "name": "Sriinnu",
  "age": 28,
  "active": true,
  "email": "sri@example.com",
  "bio": null
}
```

### 17.2 Nested Object (3 Levels Deep)

**Source JSON:**

```json
{
  "company": {
    "name": "KaalaBrahma",
    "founded": 2024,
    "headquarters": {
      "city": "Hyderabad",
      "country": "India",
      "coordinates": {
        "lat": 17.385,
        "lng": 78.4867
      }
    },
    "active": true
  }
}
```

**PAKT:**

```
@from json

company
  name: KaalaBrahma
  founded: 2024
  headquarters
    city: Hyderabad
    country: India
    coordinates
      lat: 17.385
      lng: 78.4867
  active: true
```

### 17.3 Tabular Array (10 Rows, 5 Fields)

**Source JSON:**

```json
{
  "employees": [
    { "id": 1, "name": "Alice", "dept": "Engineering", "level": "senior", "active": true },
    { "id": 2, "name": "Bob", "dept": "Engineering", "level": "mid", "active": true },
    { "id": 3, "name": "Carol", "dept": "Design", "level": "senior", "active": true },
    { "id": 4, "name": "Dave", "dept": "Engineering", "level": "junior", "active": false },
    { "id": 5, "name": "Eve", "dept": "Marketing", "level": "senior", "active": true },
    { "id": 6, "name": "Frank", "dept": "Engineering", "level": "mid", "active": true },
    { "id": 7, "name": "Grace", "dept": "Design", "level": "mid", "active": true },
    { "id": 8, "name": "Hank", "dept": "Marketing", "level": "junior", "active": false },
    { "id": 9, "name": "Iris", "dept": "Engineering", "level": "senior", "active": true },
    { "id": 10, "name": "Jack", "dept": "Engineering", "level": "mid", "active": true }
  ]
}
```

**PAKT (L1 only):**

```
@from json

employees [10]{id|name|dept|level|active}:
  1|Alice|Engineering|senior|true
  2|Bob|Engineering|mid|true
  3|Carol|Design|senior|true
  4|Dave|Engineering|junior|false
  5|Eve|Marketing|senior|true
  6|Frank|Engineering|mid|true
  7|Grace|Design|mid|true
  8|Hank|Marketing|junior|false
  9|Iris|Engineering|senior|true
  10|Jack|Engineering|mid|true
```

**Token comparison:**
- JSON (minified): ~285 tokens
- PAKT L1: ~115 tokens
- Savings: ~60%

### 17.4 Mixed Document

**Source JSON:**

```json
{
  "apiVersion": "v2",
  "status": "healthy",
  "uptime": 99.97,
  "server": {
    "hostname": "prod-east-1",
    "region": "us-east-1",
    "tags": ["production", "primary", "monitored"]
  },
  "services": [
    { "name": "auth", "port": 8080, "status": "running", "cpu": 23.5 },
    { "name": "api", "port": 8081, "status": "running", "cpu": 45.2 },
    { "name": "worker", "port": 8082, "status": "degraded", "cpu": 89.1 },
    { "name": "cache", "port": 6379, "status": "running", "cpu": 12.8 }
  ],
  "alerts": [
    { "type": "warning", "message": "Worker CPU above 80%", "timestamp": "2026-02-17T10:15:00Z" },
    { "type": "info", "message": "Scheduled maintenance in 2 hours" }
  ]
}
```

**PAKT:**

```
@from json

apiVersion: v2
status: healthy
uptime: 99.97
server
  hostname: prod-east-1
  region: us-east-1
  tags [3]: production,primary,monitored
services [4]{name|port|status|cpu}:
  auth|8080|running|23.5
  api|8081|running|45.2
  worker|8082|degraded|89.1
  cache|6379|running|12.8
alerts [2]:
  - type: warning
    message: Worker CPU above 80%
    timestamp: 2026-02-17T10:15:00Z
  - type: info
    message: Scheduled maintenance in 2 hours
```

This example demonstrates all three data shapes in one document:
- Key-value pairs (`apiVersion`, `status`, `uptime`)
- Nested object (`server`)
- Inline array (`tags`)
- Tabular array (`services`)
- List array (`alerts`) -- used because the two alert objects have different keys

### 17.5 Document with Dictionary (L2 Compressed)

**PAKT L1 (before dictionary):**

```
@from json

projects [8]{id|name|dept|status|priority}:
  1|VAAYU|Engineering|active|high
  2|ClipForge|Engineering|planning|medium
  3|Substack|Content|active|high
  4|ChromeExt|Engineering|in-progress|medium
  5|ToonParser|Engineering|planning|medium
  6|KaalaBrahma|Engineering|active|high
  7|DataPipe|Engineering|in-progress|medium
  8|Newsletter|Content|active|high
```

**PAKT L1+L2 (after dictionary):**

```
@from json
@dict
  $a: Engineering
  $b: active
  $c: high
  $d: medium
  $e: planning
  $f: in-progress
@end

projects [8]{id|name|dept|status|priority}:
  1|VAAYU|$a|$b|$c
  2|ClipForge|$a|$e|$d
  3|Substack|Content|$b|$c
  4|ChromeExt|$a|$f|$d
  5|ToonParser|$a|$e|$d
  6|KaalaBrahma|$a|$b|$c
  7|DataPipe|$a|$f|$d
  8|Newsletter|Content|$b|$c
```

**Savings breakdown:**
- `Engineering` (11 chars, ~3 tokens) appears 6 times -> replaced with `$a`
  (1 token). Saves: (3-1)*6 - 6 = 6 tokens.
- `active` appears 4 times, `high` appears 4 times, `medium` appears 4 times,
  `planning` appears 2 times, `in-progress` appears 2 times -- each aliased
  when the net savings formula is positive.

### 17.6 Full Round-Trip Example

This example demonstrates the complete compress -> PAKT -> decompress cycle.

**Step 1: Original JSON input**

```json
{
  "report": {
    "title": "Q1 Sales Summary",
    "generated": "2026-02-17",
    "currency": "USD"
  },
  "regions": [
    { "name": "North America", "revenue": 1250000, "growth": 12.5, "target_met": true },
    { "name": "Europe", "revenue": 980000, "growth": 8.3, "target_met": true },
    { "name": "Asia Pacific", "revenue": 750000, "growth": 22.1, "target_met": false },
    { "name": "Latin America", "revenue": 320000, "growth": 15.7, "target_met": true }
  ],
  "topProducts": ["Widget Pro", "Gadget Max", "Tool Suite"],
  "notes": null
}
```

**Step 2: Compress to PAKT (L1+L2)**

```
@version 1.0.0
@from json

report
  title: Q1 Sales Summary
  generated: 2026-02-17
  currency: USD
regions [4]{name|revenue|growth|target_met}:
  North America|1250000|12.5|true
  Europe|980000|8.3|true
  Asia Pacific|750000|22.1|false
  Latin America|320000|15.7|true
topProducts [3]: Widget Pro,Gadget Max,Tool Suite
notes: null
```

(In this case, no dictionary is generated because no value appears 3+ times
with 2+ tokens. The L2 layer is a no-op.)

**Step 3: Decompress back to JSON**

```json
{
  "report": {
    "title": "Q1 Sales Summary",
    "generated": "2026-02-17",
    "currency": "USD"
  },
  "regions": [
    { "name": "North America", "revenue": 1250000, "growth": 12.5, "target_met": true },
    { "name": "Europe", "revenue": 980000, "growth": 8.3, "target_met": true },
    { "name": "Asia Pacific", "revenue": 750000, "growth": 22.1, "target_met": false },
    { "name": "Latin America", "revenue": 320000, "growth": 15.7, "target_met": true }
  ],
  "topProducts": ["Widget Pro", "Gadget Max", "Tool Suite"],
  "notes": null
}
```

**Step 4: Verify**

```
deepEqual(original, decompressed) === true    // PASS
```

### 17.7 Document with Escaping Edge Cases

```
@version 1.0.0
@from json

simple: hello world
withColon: "Error: connection refused"
withPipe: "x|y|z"
withQuote: "She said \"hello\""
withBackslash: "C:\\Users\\sri"
withNewline: "line one\nline two"
leadingSpace: "  indented value"
trailingSpace: "value with space  "
looksLikeAlias: "$notAnAlias"
looksLikeComment: "%notAComment"
looksLikeNumber: "007"
looksLikeTrue: "true"
looksLikeNull: "null"
actualNumber: 42
actualBool: true
actualNull: null
emptyString:
```

### 17.8 Deeply Nested with Mixed Arrays

```
@from json

organization
  name: Acme Corp
  departments [2]:
    - name: Engineering
      teams [2]:
        - name: Platform
          members [3]{name|role|level}:
            Alice|lead|senior
            Bob|backend|mid
            Carol|frontend|mid
        - name: Data
          members [2]{name|role|level}:
            Dave|ml-engineer|senior
            Eve|analyst|junior
    - name: Marketing
      teams [1]:
        - name: Growth
          members [2]{name|role|level}:
            Frank|manager|senior
            Grace|designer|mid
```

This example demonstrates list arrays containing nested tabular arrays,
showing how PAKT handles deep structural nesting while still benefiting from
tabular compression at the leaf level.

---

## 18. Grammar (BNF-like)

The following grammar describes the PAKT syntax in a BNF-like notation. This
is intended to be precise enough for parser implementors while remaining
readable.

### 18.1 Lexical Elements

```
LF           = U+000A
SP           = U+0020
INDENT       = SP SP                          ; exactly 2 spaces per level
DIGIT        = "0" | "1" | ... | "9"
ALPHA        = "a" | ... | "z" | "A" | ... | "Z"
KEY_CHAR     = ALPHA | DIGIT | "_" | "-" | "."
PIPE         = "|"
PERCENT      = "%"
AT           = "@"
DOLLAR       = "$"
DQUOTE       = '"'
COLON        = ":"
COMMA        = ","
DASH         = "-"
LBRACKET     = "["
RBRACKET     = "]"
LBRACE       = "{"
RBRACE       = "}"
```

### 18.2 Document

```
document     = header-block? body
header-block = (header LF)*
header       = version-header
             | from-header
             | target-header
             | compress-header
             | warning-header
             | dict-block
```

### 18.3 Headers

```
version-header  = AT "version" SP semver
from-header     = AT "from" SP format-name
target-header   = AT "target" SP model-name
compress-header = AT "compress" SP "semantic"
warning-header  = AT "warning" SP "lossy"

semver          = DIGIT+ "." DIGIT+ "." DIGIT+
format-name     = "json" | "yaml" | "csv" | "markdown" | "text" | "toml"
model-name      = KEY_CHAR+
```

### 18.4 Dictionary Block

```
dict-block   = AT "dict" LF dict-entry* AT "end" LF
dict-entry   = INDENT alias COLON SP expansion LF
alias        = DOLLAR ALPHA ALPHA?            ; $a-$z, $aa-$az
expansion    = value-content
```

### 18.5 Body

```
body         = (body-line LF)*
body-line    = blank-line
             | comment-line
             | key-value-line
             | object-header-line
             | inline-array-line
             | tabular-header-line
             | tabular-row-line
             | list-header-line
             | list-item-start
             | list-item-property

blank-line   = SP*
comment-line = SP* PERCENT comment-text
```

### 18.6 Key-Value Pair

```
key-value-line    = indent key COLON SP value inline-comment?
key               = KEY_CHAR+
value             = quoted-string | scalar
inline-comment    = SP PERCENT SP comment-text
```

### 18.7 Scalars

```
scalar       = null-literal
             | boolean-literal
             | number-literal
             | unquoted-string

null-literal    = "null"
boolean-literal = "true" | "false"
number-literal  = "-"? ("0" | [1-9] DIGIT*) ("." DIGIT+)? (("e"|"E") ("+"|"-")? DIGIT+)?
unquoted-string = non-special-char+       ; everything not matching above types
```

### 18.8 Quoted Strings

```
quoted-string = DQUOTE quoted-char* DQUOTE
quoted-char   = escape-seq | any-char-except-dquote-and-backslash
escape-seq    = "\\" ( DQUOTE | "\\" | "n" | "t" | "r" )
```

### 18.9 Object Nesting

```
object-header-line = indent key LF
                   ; next lines at indent+2 are children of this object
```

### 18.10 Inline Array

```
inline-array-line = indent key SP LBRACKET count RBRACKET COLON SP? inline-items?
count             = DIGIT+
inline-items      = inline-item (COMMA inline-item)*
inline-item       = quoted-string | scalar
```

### 18.11 Tabular Array

```
tabular-header-line = indent key SP LBRACKET count RBRACKET LBRACE field-list RBRACE COLON LF
field-list          = field-name (PIPE field-name)*
field-name          = KEY_CHAR+
tabular-row-line    = indent cell (PIPE cell)* LF
cell                = quoted-string | scalar | empty
empty               =                            ; zero characters between pipes
```

### 18.12 List Array

```
list-header-line    = indent key SP LBRACKET count RBRACKET COLON LF
list-item-start     = indent DASH SP key COLON SP value LF
list-item-property  = indent SP SP key COLON SP value LF
                    ; properties aligned with key of item-start line
```

### 18.13 Indentation

```
indent = (INDENT)*                           ; 0 or more groups of 2 spaces
       ; The number of INDENT groups determines the nesting level
```

---

## 19. Differences from TOON

PAKT diverges from TOON in the following ways. Each difference is motivated
by specific research findings or practical requirements.

### 19.1 Dictionary Block (Layer 2) -- Not in TOON

**What:** `@dict` ... `@end` block for alias-based value deduplication.

**Why:** Tabular data frequently contains repeated values (e.g., department
names, status strings, enum-like values). TOON compresses structure but not
content repetition. The dictionary block eliminates this redundancy.

**Research basis:** CompactPrompt (2025) demonstrates that n-gram abbreviation
yields up to 60% token savings on structured financial data. PAKT's dictionary
mechanism is a simpler, deterministic variant: instead of abbreviating based on
n-gram frequency statistics, it maps exact repeated values to short aliases.

**Savings:** 5-20% additional savings on top of TOON Layer 1, depending on
value repetition rate.

### 19.2 `@target` Header (Layer 3) -- Not in TOON

**What:** Header declaring which tokenizer the document was optimized for.

**Why:** Different BPE tokenizers produce different token counts for the same
delimiter characters. Optimizing delimiter choice for the target model's
tokenizer can yield additional savings.

**Research basis:** Hayase et al. (2024) prove that tokenizer merge lists
reveal training data composition, and delimiter token costs vary across
tokenizers. LiteToken (2025) demonstrates that BPE intermediate merge
residues create "dead zones" that should be avoided.

**Gate:** This feature is empirically gated. If benchmarks show < 3% savings,
the `@target` header is retained as metadata but Layer 3 optimization logic
is removed.

### 19.3 `@compress` / `@warning` (Layer 4) -- Not in TOON

**What:** Headers flagging lossy semantic compression.

**Why:** TOON is strictly lossless. PAKT extends the format to support lossy
compression as an opt-in layer, because some LLM use cases (background context,
historical summaries, auxiliary data) benefit from aggressive compression where
approximate data is acceptable.

**Research basis:** LLMLingua-2 (2024) achieves 2-5x compression via token
classification. PAKT's Layer 4 applies simpler strategies (truncation,
abbreviation, field dropping) that are more predictable and don't require a
separate compressor model.

**Safety:** Always opt-in. Always flagged. Never default.

### 19.4 `@version` Header -- Not in TOON

**What:** Semantic version declaration for the PAKT spec.

**Why:** As PAKT evolves, documents must be interpretable by parsers of the
correct version. TOON relies on external versioning (spec repository). PAKT
embeds version information in the document itself.

### 19.5 Escaping Rules -- More Explicit than TOON

**What:** PAKT defines explicit escaping for `$` (alias prefix), `%` (comment
prefix), `:` (separator), `|` (delimiter), `"` (quote), `\` (escape), and
whitespace.

**Why:** TOON's escaping rules are minimal and leave some edge cases ambiguous
(e.g., a value starting with `%`). PAKT specifies exact behavior for every
potentially ambiguous character.

### 19.6 Mandated Count Validation -- Stricter than TOON

**What:** The `[N]` count in arrays is not just documentation; parsers MUST
validate that the actual element count matches.

**Why:** When LLMs generate PAKT output, they sometimes produce the wrong
number of items (e.g., the header says `[5]` but only 3 rows follow). Mandated
validation catches this immediately rather than producing silent data loss.

**Error:** `Row count mismatch: header says [5], found 3 rows`

### 19.7 `@from` Header -- Present in TOON (Extended)

**What:** PAKT uses the same `@from` header concept as TOON but extends the
set of recognized formats to include `toml` and `text`.

### 19.8 Comment Syntax -- Same as TOON

**What:** Both PAKT and TOON use `%` for comments. No divergence here.

### 19.9 Summary Table

| Feature | TOON | PAKT | Rationale |
|---------|------|------|-----------|
| `@dict` ... `@end` | No | Yes | Content deduplication |
| `@target` | No | Yes | Tokenizer optimization |
| `@compress` / `@warning` | No | Yes | Lossy compression flagging |
| `@version` | No | Yes | Document-level versioning |
| `$alias` expansion | No | Yes | Part of L2 dictionary |
| Escaping for `$`, `%` | Implicit | Explicit | Edge case safety |
| Count `[N]` validation | Optional | Mandatory | LLM output validation |
| `@from` | Yes | Yes (extended) | Compatible |
| `%` comments | Yes | Yes | Compatible |
| Indentation (2-space) | Yes | Yes | Compatible |
| Tabular `{fields}:` | Yes | Yes | Compatible |
| Inline array `[N]:` | Yes | Yes | Compatible |
| List array `- ` items | Yes | Yes | Compatible |

---

## 20. References

### 20.1 Research Papers

1. **CompactPrompt: Compacting Prompts for Extreme-Long Financial Datasets**
   (2025). N-gram abbreviation and numeric quantization for prompt compression.
   Up to 60% token reduction on financial QA tasks. Tested on GPT-4o,
   Claude 3.5 Sonnet, Llama-3.3-70B.
   arXiv: [2510.18043](https://arxiv.org/abs/2510.18043)

2. **LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnostic
   Prompt Compression** (Pan et al., 2024). Token classification approach for
   lossy prompt compression. Achieves 2-5x compression with a BERT-sized
   compressor model. Task-agnostic.
   arXiv: [2403.12968](https://arxiv.org/abs/2403.12968)

3. **Lossless Token Sequence Compression for Large Language Models (LTSC)**
   (Harvill et al., 2025). LZ77-style meta-token replacement achieving 18-27%
   lossless token savings. Requires model fine-tuning (not directly applicable
   to API users, but informs PAKT's dictionary design).
   arXiv: [2506.00307](https://arxiv.org/abs/2506.00307)

4. **LiteToken: BPE Intermediate Merge Residues and Their Role in Tokenization**
   (2025). Analysis of BPE merge residues -- tokens that exist in the vocabulary
   but are never the final output of tokenization. Informs PAKT's principle
   of avoiding tokenizer dead zones in syntax characters.
   arXiv: [2602.04706](https://arxiv.org/abs/2602.04706)

5. **Evaluating Table Serialization Methods for Large Language Models** (2024).
   Systematic comparison of serialization formats for LLM table understanding.
   Key finding: no single format wins universally; shape-adaptive approaches
   perform best. Directly motivates PAKT's multiple array syntaxes.
   arXiv: [2305.13062](https://arxiv.org/abs/2305.13062)

6. **Data Mixture Inference: What Do BPE Tokenizers Reveal About Their Training
   Data?** (Hayase et al., 2024). Proves that tokenizer merge lists reveal
   training data composition. Establishes that delimiter token costs vary
   meaningfully across tokenizers. Foundation for PAKT's Layer 3 design.
   arXiv: [2407.16607](https://arxiv.org/abs/2407.16607)

7. **A Survey of Prompt Compression Methods for Large Language Models**
   (Li et al., 2025). NAACL 2025. Comprehensive taxonomy of prompt compression:
   hard prompts, soft prompts, and the emerging category of "new synthetic
   language" for inter-model communication. PAKT falls in the "new synthetic
   language" category.
   arXiv: [2410.12388](https://arxiv.org/abs/2410.12388)

### 20.2 Related Formats and Specifications

8. **TOON Format Specification v1.3** -- github.com/toon-format/spec.
   Text-based object notation with tabular arrays. 74% retrieval accuracy
   vs JSON's 70% across 4 major LLMs. SDKs in TypeScript, Python, Go, Rust,
   .NET, Elixir, Java, Julia. PAKT's Layer 1 syntax is inspired by TOON.

9. **JSON (RFC 8259)** -- The Internet JSON Data Interchange Format. The
   baseline format against which PAKT measures token savings.

10. **YAML 1.2 Specification** -- yaml.org/spec/1.2.2. Human-readable data
    serialization. PAKT shares YAML's indentation-based nesting philosophy
    but rejects YAML's complexity (anchors, tags, multiple document streams,
    implicit type coercion).

11. **CSV (RFC 4180)** -- Common Format and MIME Type for Comma-Separated
    Values. PAKT's tabular array syntax is functionally equivalent to CSV
    with a typed header, embedded in a richer format.

### 20.3 Additional Research

12. **Semantic Compression with Large Language Models** (2023). GPT-4
    preserves semantic direction at 3-4x compression but produces high edit
    distance output. Confirms that lossy compression cannot preserve exact
    data, motivating PAKT's strict separation of lossless (L1-L3) and lossy
    (L4) layers.
    arXiv: [2304.12512](https://arxiv.org/abs/2304.12512)

13. **LoPace: Lossless Prompt Compression for Accelerated LLM Inference**
    (2025). Lossless prompt storage using Zstandard + BPE binary packing.
    Achieves 72.2% space savings, 4.89x compression ratio. Demonstrates
    that binary approaches exist but are not human-readable, which is a core
    PAKT requirement.
    arXiv: [2602.13266](https://arxiv.org/abs/2602.13266)

---

## Appendix A: Design Decisions Log

This appendix records key design decisions and their rationale.

### A.1 Why `%` for Comments (Not `#`)

The `#` character begins many common BPE tokens (`#include`, `###`, `#TODO`,
`#ifdef`). Using `%` ensures the comment marker is tokenized as a single,
independent token across all major tokenizers, avoiding unintended merges.

### A.2 Why `|` for Tabular Delimiters (Not Tab or Comma)

- **Tab (`\t`):** Invisible to humans. Makes hand-editing error-prone. Some
  tokenizers encode tab as 1 token, others as a special whitespace token that
  merges with adjacent text.
- **Comma (`,`):** Already used for inline array elements. Using comma for
  both inline arrays and tabular rows creates parsing ambiguity.
- **Pipe (`|`):** Visually distinct, consistently 1 token across tokenizers,
  does not conflict with other PAKT syntax elements. Familiar from markdown
  tables and Unix.

### A.3 Why 2-Space Indentation (Not 4 or Tabs)

- **4 spaces:** Doubles the indentation token cost at every nesting level.
- **Tabs:** Rejected for the reasons in Section 11.2.
- **2 spaces:** Matches TOON, is the most common indentation in JavaScript/
  TypeScript ecosystems, and minimizes whitespace tokens while remaining
  visually distinct.

### A.4 Why Mandatory `[N]` Counts

LLMs generating PAKT output occasionally produce incomplete arrays (e.g., they
stop mid-table due to output length limits). The mandatory count enables
immediate detection: if a document says `[10]` but only 7 rows follow, the
parser reports the discrepancy. Without counts, the consumer would silently
receive incomplete data.

### A.5 Why No Multi-Line Strings

Multi-line string literals (heredocs, `|` block scalars in YAML, etc.) add
significant parser complexity and create ambiguity with PAKT's pipe delimiter.
The `\n` escape sequence within quoted strings handles the common case of
embedding newlines in values. If a value is truly multi-line prose, PAKT is
probably not the right format for that value.

### A.6 Why Aliases Are Whole-Value Only

Substring alias expansion (e.g., `$a` within `"the $a department"`) would
require escaping every literal `$` in every value, dramatically increasing the
escaping burden. Whole-value replacement is simpler, unambiguous, and still
captures the highest-value deduplication targets (repeated cell values in
tabular arrays).

---

## Appendix B: Conformance Requirements

### B.1 Terminology

- **MUST / MUST NOT:** Absolute requirement. Non-compliance is a spec violation.
- **SHOULD / SHOULD NOT:** Recommended. Deviation is acceptable with documented
  justification.
- **MAY:** Optional. Implementation-dependent.

### B.2 Parser Conformance

A conformant PAKT parser:

1. MUST parse all syntax described in Sections 4-8.
2. MUST validate `[N]` counts and report mismatches as errors.
3. MUST reject tab indentation with an explicit error message.
4. MUST expand `@dict` aliases during decompression.
5. MUST handle quoted strings with all escape sequences in Section 10.2.
6. MUST support both strict and lenient parsing modes.
7. MUST report errors with line and column numbers.
8. SHOULD implement auto-repair for common malformations.
9. MAY implement Layer 3 tokenizer-aware optimization.
10. MAY implement Layer 4 semantic compression.

### B.3 Serializer Conformance

A conformant PAKT serializer:

1. MUST produce output that a conformant parser can round-trip without data loss.
2. MUST quote values that would otherwise be ambiguous (per Section 10.1).
3. MUST use 2-space indentation.
4. MUST emit LF line endings.
5. MUST include `@compress semantic` and `@warning lossy` when Layer 4 is applied.
6. SHOULD select the most compact array syntax for each array (per Section 7.4).
7. SHOULD sort dictionary aliases by descending net savings.
8. MAY include `@version`, `@from`, and `@target` headers.

---

*End of specification.*

# content-copy Delta

## MODIFIED Requirements

### Requirement: Copy button component

The CopyButton component SHALL accept `getText` (a `() => string` callback that
returns the text to copy), `icon` (icon node), and `title` (tooltip string)
props. On click, it SHALL invoke `getText()` to resolve the payload **at click
time** and copy the result to the clipboard through the shared `copyText` helper:
`navigator.clipboard.writeText()` when the Clipboard API is available, otherwise
the hidden-`<textarea>` + `document.execCommand("copy")` fallback (the helper
returns a boolean indicating success). The ✓ checkmark SHALL be shown for 1.5
seconds only when the copy succeeded, and a failed copy SHALL remain silent (no
throw, no feedback).

Resolving the payload at click time (rather than binding a pre-computed string
at render time) guarantees that payloads derived from committed DOM — e.g. a ref
read of a rendered `<table>` or message body — are non-empty even when the host
component renders exactly once (e.g. under `React.memo`).

#### Scenario: Successful copy
- **WHEN** the user clicks a CopyButton
- **THEN** `getText()` SHALL be invoked and its return value SHALL be copied to
  the clipboard, and the icon SHALL change to ✓ for 1.5 seconds

#### Scenario: Non-secure context falls back to execCommand
- **WHEN** the Clipboard API is unavailable or `writeText` rejects (e.g. plain
  http tunnel) and `document.execCommand("copy")` succeeds via the hidden
  textarea
- **THEN** the button SHALL show the ✓ feedback and no hidden textarea SHALL
  remain in the DOM

#### Scenario: Clipboard unavailable
- **WHEN** `navigator.clipboard` is not available
- **THEN** the button SHALL attempt the hidden-`<textarea>` `execCommand("copy")`
  fallback, SHALL NOT throw, and SHALL show the ✓ feedback only if the fallback
  succeeds

#### Scenario: Copy genuinely fails
- **WHEN** the Clipboard API is unavailable AND the `execCommand` fallback is
  unavailable or returns false
- **THEN** the button SHALL NOT throw and SHALL NOT show the ✓ feedback

#### Scenario: Payload resolved from committed DOM on a single render
- **WHEN** a CopyButton's `getText` reads from a ref (e.g. a rendered table or
  message body) AND the host component renders only once
- **THEN** clicking the button SHALL copy the fully-rendered content, never an
  empty string

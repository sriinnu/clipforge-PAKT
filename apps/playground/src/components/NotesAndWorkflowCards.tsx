/**
 * Side-by-side "Release Notes" and "Inspect-First Workflow" cards
 * rendered between the controls and the workspace.
 *
 * Pure presentation. Parent supplies the dynamic insight strings and
 * copy-button click handler so this component never touches state.
 */

import { RELEASE_NOTES, WORKFLOW_SNIPPET_PREVIEW } from '../app-constants';

/**
 * Props for {@link NotesAndWorkflowCards}.
 *
 * `workflowNotice` is the transient "CLI snippet copied" toast that
 * the parent clears after ~1.8s; rendered as a small badge in the card
 * header when set.
 */
export interface NotesAndWorkflowCardsProps {
  /** Transient confirmation message after a copy action, or `null`. */
  workflowNotice: string | null;
  /** Title for the dynamic "Current payload" insight tile. */
  insightTitle: string;
  /** Body for the dynamic "Current payload" insight tile. */
  insightBody: string;
  /** Click handler for the CLI / MCP copy buttons. */
  onCopyWorkflow: (label: 'cli' | 'mcp') => void;
}

/**
 * Render the two static-ish information cards under the controls. The
 * release notes are fully static; the workflow card has a single
 * dynamic insight tile and two copy buttons.
 */
export function NotesAndWorkflowCards({
  workflowNotice,
  insightTitle,
  insightBody,
  onCopyWorkflow,
}: NotesAndWorkflowCardsProps) {
  return (
    <>
      <section className="card notes-card">
        <div className="notes-header">
          <p className="panel-label">Release Notes</p>
          <strong>What to keep in mind while testing</strong>
        </div>
        <div className="notes-grid">
          {RELEASE_NOTES.map((note) => (
            <article key={note.title} className="note-chip">
              <strong>{note.title}</strong>
              <p>{note.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card workflow-card">
        <div className="notes-header">
          <div>
            <p className="panel-label">Inspect-First Workflow</p>
            <strong>
              Use the playground to feel the behavior, then wire the same flow into the real
              surface.
            </strong>
          </div>
          {workflowNotice ? <span className="workflow-notice">{workflowNotice}</span> : null}
        </div>
        <div className="workflow-grid">
          <article className="workflow-step">
            <p className="panel-label">Current payload</p>
            <strong>{insightTitle}</strong>
            <p>{insightBody}</p>
          </article>
          <article className="workflow-step">
            <p className="panel-label">CLI handoff</p>
            <strong>Inspect first, then pack only when it helps.</strong>
            <pre className="workflow-code">{WORKFLOW_SNIPPET_PREVIEW.cli}</pre>
            <p className="sample-note">
              Copy action includes your current Input payload in a shell-safe encoded form so the
              snippet runs as pasted.
            </p>
            <button className="ghost" type="button" onClick={() => onCopyWorkflow('cli')}>
              Copy CLI snippet
            </button>
          </article>
          <article className="workflow-step">
            <p className="panel-label">MCP handoff</p>
            <strong>Run PAKT as a local stdio MCP server for agents.</strong>
            <pre className="workflow-code">{WORKFLOW_SNIPPET_PREVIEW.mcp}</pre>
            <button className="ghost" type="button" onClick={() => onCopyWorkflow('mcp')}>
              Copy MCP config
            </button>
          </article>
        </div>
      </section>
    </>
  );
}

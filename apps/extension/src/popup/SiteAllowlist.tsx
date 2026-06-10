/**
 * Site allowlist editor.
 *
 * Structured add/remove UI for `settings.siteWhitelist` — the list of
 * hostnames the content script may act on. Replaces the old free-form
 * textarea so entries are validated as hostnames before they are persisted.
 *
 * Semantics (mirrors `isHostAllowed()` in content-script.ts):
 *   - empty list  → the content script runs on every site the manifest matches
 *   - non-empty   → exact, case-insensitive hostname match required
 *
 * Entries outside the manifest's match list are legal but inert — the
 * content script is never injected there — so those rows get a dim
 * "not a supported site" marker instead of being rejected.
 */

import { useId, useState } from 'react';
import { SUPPORTED_SITE_HOSTS } from '../shared/site-support';

/**
 * RFC-1123-style hostname check: dot-separated labels of letters, digits and
 * inner hyphens, 253 chars max overall. Requires at least one dot so bare
 * words like "localhost" (never matched by the manifest) are rejected early.
 */
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * Normalize raw user input into a bare hostname: trims whitespace, lowercases,
 * and strips any scheme, path, port, or query the user pasted along.
 *
 * @param raw - Untrusted input from the add-host field.
 * @returns The candidate hostname (possibly still invalid — validate after).
 */
export function normalizeHostInput(raw: string): string {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  value = value.replace(/[/?#].*$/, ''); // path / query / hash
  value = value.replace(/:\d+$/, ''); // port
  return value;
}

/**
 * Validate a normalized hostname.
 *
 * @param host - Output of {@link normalizeHostInput}.
 * @returns True when the string is a plausible public hostname.
 */
export function isValidHostname(host: string): boolean {
  return HOSTNAME_RE.test(host);
}

interface SiteAllowlistProps {
  /** Current allowlist (already normalized, persisted order preserved). */
  hosts: string[];
  /** Called with the full next list whenever the user adds or removes a host. */
  onChange: (hosts: string[]) => void;
}

/**
 * Allowlist editor: current entries with remove buttons, one-tap suggestion
 * chips for supported sites not yet listed, and a validated add field.
 *
 * Fully keyboard-operable: the add field submits on Enter, every remove
 * button is a real `<button>` with an explicit accessible name, and the
 * validation error is announced via `role="alert"` + `aria-describedby`.
 */
export function SiteAllowlist({ hosts, onChange }: SiteAllowlistProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  /** Validate the draft and append it to the list (clears the field on success). */
  const addHost = (raw: string) => {
    const host = normalizeHostInput(raw);
    if (host.length === 0) return;
    if (!isValidHostname(host)) {
      setError(`“${host}” is not a valid hostname (e.g. chatgpt.com)`);
      return;
    }
    if (hosts.some((existing) => existing.toLowerCase() === host)) {
      setError(`“${host}” is already in the list`);
      return;
    }
    setError(null);
    setDraft('');
    onChange([...hosts, host]);
  };

  /** Remove one host, preserving the order of the rest. */
  const removeHost = (host: string) => {
    onChange(hosts.filter((entry) => entry !== host));
  };

  const suggestions = SUPPORTED_SITE_HOSTS.filter(
    (candidate) => !hosts.some((existing) => existing.toLowerCase() === candidate),
  );

  return (
    <div style={rootStyle}>
      {hosts.length === 0 ? (
        <span style={emptyStyle}>
          Empty — ClipForge runs on every supported site. Add a hostname to restrict it.
        </span>
      ) : (
        <ul style={listStyle} aria-label="Allowed sites">
          {hosts.map((host) => (
            <li key={host} style={rowStyle}>
              <span style={hostStyle}>
                {host}
                {!SUPPORTED_SITE_HOSTS.includes(host.toLowerCase()) ? (
                  <span style={inertStyle}> — not a supported site, has no effect</span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => removeHost(host)}
                aria-label={`Remove ${host} from allowlist`}
                style={removeBtnStyle}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {suggestions.length > 0 ? (
        <div style={chipsRowStyle}>
          {suggestions.map((host) => (
            <button
              type="button"
              key={host}
              onClick={() => addHost(host)}
              aria-label={`Add ${host} to allowlist`}
              style={chipStyle}
            >
              + {host}
            </button>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          addHost(draft);
        }}
        style={addRowStyle}
      >
        <label htmlFor={inputId} style={visuallyHiddenStyle}>
          Add a hostname to the allowlist
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. chatgpt.com"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          style={inputStyle}
        />
        <button type="submit" style={addBtnStyle} disabled={draft.trim().length === 0}>
          Add
        </button>
      </form>

      {error ? (
        <span id={errorId} role="alert" style={errorStyle}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const emptyStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--cf-text-dim)',
  padding: '8px 10px',
  backgroundColor: 'var(--cf-surface)',
  borderRadius: 'var(--cf-radius-md)',
  lineHeight: 1.4,
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '7px 10px',
  backgroundColor: 'var(--cf-surface)',
  borderRadius: 'var(--cf-radius-md)',
};

const hostStyle: React.CSSProperties = {
  fontFamily: 'var(--cf-font-mono)',
  fontSize: 12,
  color: 'var(--cf-text)',
  wordBreak: 'break-all',
};

const inertStyle: React.CSSProperties = {
  fontFamily: 'var(--cf-font)',
  fontSize: 10,
  color: 'var(--cf-text-dim)',
};

const removeBtnStyle: React.CSSProperties = {
  border: '1px solid var(--cf-border)',
  background: 'transparent',
  color: 'var(--cf-text-muted)',
  borderRadius: 'var(--cf-radius-sm)',
  padding: '3px 8px',
  fontSize: 11,
  cursor: 'pointer',
  fontFamily: 'var(--cf-font)',
  flexShrink: 0,
};

const chipsRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
};

const chipStyle: React.CSSProperties = {
  border: '1px dashed var(--cf-border)',
  background: 'transparent',
  color: 'var(--cf-text-muted)',
  borderRadius: 'var(--cf-radius-sm)',
  padding: '3px 8px',
  fontSize: 11,
  cursor: 'pointer',
  fontFamily: 'var(--cf-font-mono)',
};

const addRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  borderRadius: 'var(--cf-radius-md)',
  border: '1px solid var(--cf-border)',
  backgroundColor: 'var(--cf-surface)',
  color: 'var(--cf-text)',
  padding: '8px 10px',
  fontSize: 12,
  fontFamily: 'var(--cf-font-mono)',
};

const addBtnStyle: React.CSSProperties = {
  border: 'none',
  background: 'var(--cf-accent)',
  color: '#fff',
  borderRadius: 'var(--cf-radius-md)',
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'var(--cf-font)',
};

const errorStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--cf-warn, #ffcb6b)',
};

/** Standard visually-hidden pattern — label stays available to screen readers. */
const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

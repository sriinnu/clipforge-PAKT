/**
 * @module helpers
 * Utility functions and constants shared by popup components.
 * Extracted from Popup.tsx to keep that file under the 400-line limit.
 */

/** Whether the user is on macOS (for keyboard shortcut labels). */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

/** Keyboard modifier label — Command on Mac, Ctrl elsewhere. */
export const MOD = IS_MAC ? '\u2318' : 'Ctrl';

/** Pre-built MCP server configuration snippet for clipboard copy. */
export const MCP_CONFIG_SNIPPET = JSON.stringify(
  {
    mcpServers: {
      pakt: {
        command: 'npx',
        args: ['-y', '@sriinnu/pakt', 'serve', '--stdio'],
      },
    },
  },
  null,
  2,
);

/**
 * Encode a string to base64, handling multi-byte characters correctly
 * via TextEncoder.
 *
 * @param input - Raw UTF-8 string
 * @returns Base64-encoded string
 */
export function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Build a CLI workflow snippet for the given input text.
 * Encodes the payload as base64 and generates `pakt inspect` + `pakt auto`
 * pipeline commands.
 *
 * @param input - Raw input text (or empty for a placeholder)
 * @returns Multi-line CLI command string
 */
export function buildCliWorkflowSnippet(input: string): string {
  const payload =
    input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim() ||
    '{"paste":"structured payload here","tip":"run pakt inspect first"}';
  const payloadBase64 = encodeBase64(payload);
  const decodeCommand = `node --input-type=module -e "process.stdout.write(Buffer.from('${payloadBase64}','base64').toString('utf8'))"`;
  return [`${decodeCommand} | pakt inspect`, `${decodeCommand} | pakt auto`].join('\n');
}

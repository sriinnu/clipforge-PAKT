/**
 * @module useActiveTab
 * Custom hook to detect whether the active browser tab supports inline
 * ClipForge injection. Extracted from Popup.tsx to keep it under 400 lines.
 */

import { useEffect, useState } from 'react';
import { getSupportedSite, listSupportedSiteLabels } from '../shared/site-support';

/** Active tab support status and metadata. */
export interface ActiveTabSupport {
  /** Detection status: loading, supported, unsupported, or unknown. */
  status: 'loading' | 'supported' | 'unsupported' | 'unknown';
  /** Hostname of the active tab (if available). */
  hostname: string | null;
  /** Human-readable label for the supported site (e.g. "ChatGPT"). */
  label: string | null;
}

/** Comma-separated list of supported site labels for UI messages. */
const SUPPORTED_SITE_LABELS = listSupportedSiteLabels();

/**
 * Detect the active tab's support status for inline ClipForge injection.
 * Uses the Chrome tabs API (gracefully degrades in non-extension contexts).
 *
 * @returns Active tab support state and derived UI text.
 */
export function useActiveTab() {
  const [activeTabSupport, setActiveTabSupport] = useState<ActiveTabSupport>({
    status: 'loading',
    hostname: null,
    label: null,
  });

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
      setActiveTabSupport({ status: 'unknown', hostname: null, label: null });
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        setActiveTabSupport({ status: 'unknown', hostname: null, label: null });
        return;
      }

      const rawUrl = tabs[0]?.url;
      if (!rawUrl) {
        setActiveTabSupport({ status: 'unknown', hostname: null, label: null });
        return;
      }

      try {
        const hostname = new URL(rawUrl).hostname;
        const supportedSite = getSupportedSite(hostname);
        setActiveTabSupport({
          status: supportedSite ? 'supported' : 'unsupported',
          hostname,
          label: supportedSite?.label ?? null,
        });
      } catch {
        setActiveTabSupport({ status: 'unknown', hostname: null, label: null });
      }
    });
  }, []);

  /* Derived UI text */
  const siteSupportTitle =
    activeTabSupport.status === 'supported'
      ? `Inline support active on ${activeTabSupport.label}`
      : activeTabSupport.status === 'unsupported'
        ? `Inline support not available on ${activeTabSupport.hostname}`
        : 'Inline site support unavailable';

  const siteSupportBody =
    activeTabSupport.status === 'supported'
      ? 'This tab supports the inline ClipForge pill. You can still use the popup locally and copy the result back into the chat box when you want tighter control.'
      : activeTabSupport.status === 'unsupported'
        ? `This popup still works locally, but inline injection is currently validated for ${SUPPORTED_SITE_LABELS}. Use Copy Result here or move repeated workflows into the CLI or MCP server.`
        : `The popup can still compress locally. Inline injection is currently validated for ${SUPPORTED_SITE_LABELS}.`;

  return { activeTabSupport, siteSupportTitle, siteSupportBody };
}

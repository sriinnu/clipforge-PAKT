export interface SupportedSiteDescriptor {
  host: string;
  label: string;
  selectors: string[];
}

const SUPPORTED_SITES: readonly SupportedSiteDescriptor[] = [
  {
    host: 'chat.openai.com',
    label: 'ChatGPT (legacy)',
    selectors: ['#prompt-textarea', 'textarea[data-id="root"]', 'div[contenteditable="true"]'],
  },
  {
    host: 'chatgpt.com',
    label: 'ChatGPT',
    selectors: ['#prompt-textarea', 'textarea[data-id="root"]', 'div[contenteditable="true"]'],
  },
  {
    host: 'claude.ai',
    label: 'Claude',
    selectors: ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]'],
  },
  {
    host: 'gemini.google.com',
    label: 'Gemini',
    selectors: [
      '.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"]',
      'rich-textarea textarea',
    ],
  },
] as const;

export const SITE_SELECTORS: Readonly<Record<string, string[]>> = Object.fromEntries(
  SUPPORTED_SITES.map((site) => [site.host, [...site.selectors]]),
);

export const SUPPORTED_SITE_HOSTS = SUPPORTED_SITES.map((site) => site.host);

export function getSupportedSite(hostname: string): SupportedSiteDescriptor | null {
  const normalized = hostname.toLowerCase();
  return SUPPORTED_SITES.find((site) => site.host === normalized) ?? null;
}

export function listSupportedSiteLabels(): string {
  return SUPPORTED_SITES.map((site) => site.label).join(', ');
}

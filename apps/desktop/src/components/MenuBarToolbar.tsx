/**
 * Top toolbar of the menu-bar panel: brand mark, watch / history pills,
 * and the two icon buttons that open the History and Settings overlays.
 *
 * Pure presentation — parent owns the panel state and click handlers.
 */

import clipforgeMark from '../../../../assets/clipforge-mark.svg';

/** Props for {@link MenuBarToolbar}. */
export interface MenuBarToolbarProps {
  autoCompress: boolean;
  historyEnabled: boolean;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}

/**
 * Render the toolbar strip at the top of the panel. The two SVG icon
 * buttons (history clock + settings gear) are inlined here because they
 * are unique to this surface.
 */
export function MenuBarToolbar({
  autoCompress,
  historyEnabled,
  onOpenHistory,
  onOpenSettings,
}: MenuBarToolbarProps) {
  return (
    <div className="desktop-toolbar">
      <div className="desktop-toolbar-left">
        <div className="desktop-brand">
          <div className="desktop-brand-mark">
            <img src={clipforgeMark} alt="" className="desktop-brand-mark-image" />
          </div>
          <div className="desktop-brand-copy">
            <h1 className="desktop-brand-title">ClipForge</h1>
            <p className="desktop-brand-subtitle">Structured clipboard packer</p>
          </div>
        </div>
      </div>
      <div className="desktop-toolbar-actions">
        <div className="desktop-toolbar-pills">
          <span className="desktop-toolbar-pill">{autoCompress ? 'Watch' : 'Manual'}</span>
          <span className="desktop-toolbar-pill">{historyEnabled ? 'History' : 'Private'}</span>
        </div>
        <button
          type="button"
          onClick={onOpenHistory}
          title="History"
          className="desktop-icon-button"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <title>History</title>
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          className="desktop-icon-button"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <title>Settings</title>
            <path
              fillRule="evenodd"
              d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.2.966.46 1.397.772l1.4-.56a1 1 0 011.12.32l.68 1.178a1 1 0 01-.14 1.124l-1.107.913c.048.514.048 1.033 0 1.547l1.107.913a1 1 0 01.14 1.124l-.68 1.178a1 1 0 01-1.12.32l-1.4-.56c-.43.312-.9.572-1.397.772l-.295 1.473a1 1 0 01-.98.804H9.32a1 1 0 01-.98-.804l-.295-1.473a5.957 5.957 0 01-1.397-.772l-1.4.56a1 1 0 01-1.12-.32l-.68-1.178a1 1 0 01.14-1.124l1.107-.913a5.93 5.93 0 010-1.547L3.587 7.87a1 1 0 01-.14-1.124l.68-1.178a1 1 0 011.12-.32l1.4.56c.43-.312.9-.572 1.397-.772l.295-1.473zM10 13a3 3 0 100-6 3 3 0 000 6z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

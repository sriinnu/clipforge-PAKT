import type { PaktLayers } from '@sriinnu/pakt';
import type { FC } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

interface LayerInfo {
  key: keyof PaktLayers;
  label: string;
  code: string;
  defaultOn: boolean;
  disabled: boolean;
  badge?: string;
  badgeTone?: 'warning' | 'danger';
  disabledReason?: string;
  lossy: boolean;
}

const LAYERS: LayerInfo[] = [
  {
    key: 'structural',
    label: 'Structural',
    code: 'L1',
    defaultOn: true,
    disabled: true,
    disabledReason: 'Core structural layer is always on in the desktop app.',
    lossy: false,
  },
  {
    key: 'dictionary',
    label: 'Dictionary',
    code: 'L2',
    defaultOn: true,
    disabled: false,
    lossy: false,
  },
  {
    key: 'tokenizerAware',
    label: 'Tokenizer',
    code: 'L3',
    defaultOn: false,
    disabled: false,
    lossy: false,
  },
  {
    key: 'semantic',
    label: 'Semantic',
    code: 'L4',
    defaultOn: false,
    disabled: true,
    badge: 'Needs budget',
    badgeTone: 'warning',
    disabledReason: 'Semantic compression needs a budget control, which the desktop app does not expose yet.',
    lossy: true,
  },
];

const LayerControls: FC = () => {
  const layers = useSettingsStore((s) => s.layers);
  const toggleLayer = useSettingsStore((s) => s.toggleLayer);

  return (
    <section className="desktop-card">
      <div className="desktop-card-inner">
        <h3 className="desktop-section-title">Compression Layers</h3>
        <div className="desktop-layer-list">
          {LAYERS.map((layer) => {
            const isOn = layers[layer.key];
            return (
              <div key={layer.key} className="desktop-layer-row">
                <div className="desktop-layer-copy">
                  <span className="desktop-layer-code">{layer.code}</span>
                  <span className="desktop-layer-name">{layer.label}</span>
                  {layer.badge && (
                    <span className={`desktop-tag ${layer.badgeTone ?? 'warning'}`}>
                      {layer.badge}
                    </span>
                  )}
                  {layer.lossy && <span className="desktop-tag danger">Lossy</span>}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  disabled={layer.disabled}
                  title={layer.disabledReason}
                  onClick={() => toggleLayer(layer.key)}
                  className={`desktop-toggle ${isOn ? 'is-on' : ''}`}
                >
                  <span className="desktop-toggle-thumb" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default LayerControls;

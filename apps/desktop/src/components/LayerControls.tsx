import { DEFAULT_SEMANTIC_BUDGET, type PaktLayers } from '@sriinnu/pakt';
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

const BASE_LAYERS: LayerInfo[] = [
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
];

const LayerControls: FC = () => {
  const layers = useSettingsStore((s) => s.layers);
  const semanticBudget = useSettingsStore((s) => s.semanticBudget);
  const setSemanticBudget = useSettingsStore((s) => s.setSemanticBudget);
  const toggleLayer = useSettingsStore((s) => s.toggleLayer);

  const semanticLayer: LayerInfo = {
    key: 'semantic',
    label: 'Semantic',
    code: 'L4',
    defaultOn: false,
    disabled: semanticBudget <= 0,
    badge: 'Lossy',
    badgeTone: 'danger',
    disabledReason:
      semanticBudget <= 0 ? 'Enter a positive semantic budget to enable L4.' : undefined,
    lossy: true,
  };

  const layersToRender = [...BASE_LAYERS, semanticLayer];

  return (
    <section className="desktop-card">
      <div className="desktop-card-inner">
        <h3 className="desktop-section-title">Compression Layers</h3>
        <div className="desktop-layer-list">
          {layersToRender.map((layer) => {
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
                  {layer.lossy && !layer.badge ? <span className="desktop-tag danger">Lossy</span> : null}
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

        <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
          <label className="desktop-section-title" htmlFor="desktop-semantic-budget">
            Semantic budget
          </label>
          <input
            id="desktop-semantic-budget"
            type="number"
            min={1}
            step={1}
            value={semanticBudget}
            onChange={(event) => {
              const nextValue = Number.parseInt(event.target.value, 10);
              setSemanticBudget(
                Number.isInteger(nextValue) && nextValue > 0 ? nextValue : DEFAULT_SEMANTIC_BUDGET,
              );
            }}
            className="desktop-select"
            aria-label="Semantic budget"
          />
          <p className="desktop-copy" style={{ margin: 0 }}>
            Required for L4. Semantic compression is lossy and should be used when token pressure matters more than exact round-trip fidelity.
          </p>
        </div>
      </div>
    </section>
  );
};

export default LayerControls;

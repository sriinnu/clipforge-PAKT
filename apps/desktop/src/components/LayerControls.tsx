import type { PaktLayers } from '@sriinnu/pakt';
import type { FC } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

interface LayerInfo {
  key: keyof PaktLayers;
  label: string;
  code: string;
  defaultOn: boolean;
  disabled: boolean;
  comingSoon: boolean;
  lossy: boolean;
}

const LAYERS: LayerInfo[] = [
  {
    key: 'structural',
    label: 'Structural',
    code: 'L1',
    defaultOn: true,
    disabled: true,
    comingSoon: false,
    lossy: false,
  },
  {
    key: 'dictionary',
    label: 'Dictionary',
    code: 'L2',
    defaultOn: true,
    disabled: false,
    comingSoon: false,
    lossy: false,
  },
  {
    key: 'tokenizerAware',
    label: 'Tokenizer',
    code: 'L3',
    defaultOn: false,
    disabled: false,
    comingSoon: true,
    lossy: false,
  },
  {
    key: 'semantic',
    label: 'Semantic',
    code: 'L4',
    defaultOn: false,
    disabled: false,
    comingSoon: false,
    lossy: true,
  },
];

const LayerControls: FC = () => {
  const layers = useSettingsStore((s) => s.layers);
  const toggleLayer = useSettingsStore((s) => s.toggleLayer);

  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500">
        Compression Layers
      </h3>
      <div className="space-y-0.5">
        {LAYERS.map((layer) => {
          const isOn = layers[layer.key];
          return (
            <div
              key={layer.key}
              className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-gray-800/50"
            >
              <div className="flex items-center gap-2">
                <span className="w-6 font-mono text-[10px] text-gray-500">{layer.code}</span>
                <span className="text-xs text-gray-300">{layer.label}</span>
                {layer.comingSoon && (
                  <span className="rounded bg-yellow-500/15 px-1 py-0.5 text-[9px] text-yellow-500">
                    Soon
                  </span>
                )}
                {layer.lossy && (
                  <span className="rounded bg-red-500/15 px-1 py-0.5 text-[9px] text-red-400">
                    Lossy!
                  </span>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isOn}
                disabled={layer.disabled}
                onClick={() => toggleLayer(layer.key)}
                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                  isOn ? 'bg-indigo-500' : 'bg-gray-600'
                } ${layer.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                    isOn ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LayerControls;

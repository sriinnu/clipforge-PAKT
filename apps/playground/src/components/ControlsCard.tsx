/**
 * Controls card: sample picker, profile selector, target-model selector,
 * optional semantic-budget input, and the static descriptive captions
 * underneath. Stateless — parent owns every value and change handler.
 */

import {
  type CacheTarget,
  PAKT_LAYER_PROFILES,
  type PaktLayerProfile,
  type PaktLayerProfileId,
  getTokenizerFamilyInfo,
} from '@sriinnu/pakt';
import { TARGET_MODELS } from '../app-constants';
import type { samples } from '../samples';

/** Single sample entry as exported by `samples.ts`. */
type Sample = (typeof samples)[number];

/**
 * Props for {@link ControlsCard}. The component is intentionally
 * "props-as-state" so it can be rendered in tests / Storybook without
 * setting up the full playground state machine.
 */
export interface ControlsCardProps {
  /** All samples to populate the dropdown. */
  samples: ReadonlyArray<Sample>;
  /** Currently selected sample id, or `''` for "Custom payload". */
  selectedSample: string;
  /** Currently active compression profile id. */
  compressionProfileId: PaktLayerProfileId;
  /** Resolved profile object for `compressionProfileId`. */
  selectedProfile: PaktLayerProfile;
  /** Currently selected target-model id. */
  targetModel: string;
  /** Currently selected provider cache target (`undefined` = off). */
  cacheTarget: CacheTarget | undefined;
  /** Raw text in the semantic-budget number input. */
  semanticBudgetInput: string;
  /** Handler invoked when the user picks a sample (or "" to clear). */
  onSampleChange: (sampleId: string) => void;
  /** Handler invoked when the profile select changes. */
  onProfileChange: (id: PaktLayerProfileId) => void;
  /** Handler invoked when the target-model select changes. */
  onTargetModelChange: (modelId: string) => void;
  /** Handler invoked when the cache-target select changes. */
  onCacheTargetChange: (target: CacheTarget | undefined) => void;
  /** Handler invoked when the semantic-budget number input changes. */
  onSemanticBudgetChange: (raw: string) => void;
}

/**
 * Render the playground controls (everything above Source Input).
 *
 * The visible profile / tokenizer caption logic is duplicated here from
 * the original inline JSX exactly to preserve copy and accessibility
 * attributes verbatim.
 */
export function ControlsCard({
  samples,
  selectedSample,
  compressionProfileId,
  selectedProfile,
  targetModel,
  cacheTarget,
  semanticBudgetInput,
  onSampleChange,
  onProfileChange,
  onTargetModelChange,
  onCacheTargetChange,
  onSemanticBudgetChange,
}: ControlsCardProps) {
  const currentSample = samples.find((sample) => sample.id === selectedSample);
  /* Resolve the tokenizer family for the selected model so we can show
     the family name and flag approximate counts (Claude / Llama fall
     back to cl100k_base). */
  const tokenizerInfo = getTokenizerFamilyInfo(targetModel);

  return (
    <div className="controls card">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '12px',
        }}
      >
        <label>
          Sample payload
          <select value={selectedSample} onChange={(event) => onSampleChange(event.target.value)}>
            <option value="">Custom payload</option>
            {samples.map((sample) => (
              <option key={sample.id} value={sample.id}>
                {sample.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Compression profile
          <select
            value={compressionProfileId}
            onChange={(event) => onProfileChange(event.target.value as PaktLayerProfileId)}
          >
            {PAKT_LAYER_PROFILES.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label} ({profile.shortLabel})
              </option>
            ))}
          </select>
        </label>
        <label>
          Target model
          <select value={targetModel} onChange={(event) => onTargetModelChange(event.target.value)}>
            {TARGET_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prompt cache target
          <select
            value={cacheTarget ?? 'off'}
            onChange={(event) => {
              const v = event.target.value;
              onCacheTargetChange(v === 'off' ? undefined : (v as CacheTarget));
            }}
          >
            <option value="off">Off</option>
            <option value="anthropic">Anthropic (5min default)</option>
            <option value="bedrock">AWS Bedrock (1h)</option>
            <option value="openai">OpenAI (auto)</option>
            <option value="google">Google Gemini (auto)</option>
          </select>
        </label>
        {selectedProfile.requiresSemanticBudget ? (
          <label>
            Semantic budget
            <input
              type="number"
              min={1}
              step={1}
              value={semanticBudgetInput}
              onChange={(event) => onSemanticBudgetChange(event.target.value)}
              style={{
                borderRadius: '999px',
                padding: '11px 14px',
                background: 'var(--panel-strong)',
                color: 'var(--ink)',
                border: '1px solid var(--line)',
              }}
            />
          </label>
        ) : null}
      </div>
      <p className="sample-note">{currentSample?.note ?? 'Editing a custom payload.'}</p>
      <p className="sample-note" style={{ marginTop: '-6px', opacity: 0.85 }}>
        {selectedProfile.description}
      </p>
      <div className="profile-badge-row">
        <span className="meta-badge">
          {selectedProfile.requiresSemanticBudget ? 'May become lossy' : 'Lossless profile'}
        </span>
        <span className="meta-badge">
          {selectedProfile.requiresSemanticBudget ? 'Budgeted semantic' : 'Reversible by design'}
        </span>
        <span className="meta-badge">{selectedProfile.shortLabel}</span>
        {selectedProfile.id === 'tokenizer' || selectedProfile.id === 'semantic' ? (
          <span className="meta-badge">Model-sensitive</span>
        ) : null}
        <span className="meta-badge" title={`Token counts computed with ${tokenizerInfo.family}`}>
          Tokenizer: {tokenizerInfo.family}
          {tokenizerInfo.exact ? '' : ' (~)'}
        </span>
      </div>
      {!tokenizerInfo.exact ? (
        <p className="sample-note" style={{ marginTop: '-6px', opacity: 0.85 }}>
          {tokenizerInfo.approximationNote}
        </p>
      ) : null}
      {selectedProfile.requiresSemanticBudget ? (
        <p className="sample-note" style={{ marginTop: '-6px', color: 'var(--warning)' }}>
          Semantic profile is lossy. It needs a positive budget and is meant for aggressive prompt
          packing, not exact formatting fidelity.
        </p>
      ) : null}
    </div>
  );
}

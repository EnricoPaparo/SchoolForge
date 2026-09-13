import {
  POOL_MODEL_PROFILE_OPTIONS,
  type PoolModelProfile,
} from '../repository/pools/aiContentClient.js';
export function AiModelProfileField({
  value,
  onChange,
}: {
  value: PoolModelProfile;
  onChange: (value: PoolModelProfile) => void;
}) {
  return (
    <label>
      Profilo modello{' '}
      <select
        aria-label="Profilo modello"
        value={value}
        onChange={(event) => onChange(event.target.value as PoolModelProfile)}
      >
        {POOL_MODEL_PROFILE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} — {option.modelId}
          </option>
        ))}
      </select>
    </label>
  );
}

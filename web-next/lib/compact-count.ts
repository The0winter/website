const units = [
  {divisor: 10_000, unit: '万'},
  {divisor: 100_000_000, unit: '亿'},
  {divisor: 1_000_000_000_000, unit: '万亿'},
] as const;

// Keep SSR and browser output identical even when compact Intl notation or
// Chinese locale data is missing (for example in some embedded mobile engines).
export function compactCountParts(value: number): {value: string; unit: string} {
  const count = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  if (count < 10_000) return {value: String(count), unit: ''};
  for (let index = 0; index < units.length; index++) {
    const {divisor, unit} = units[index];
    const rounded = Math.round(count / (divisor / 10)) / 10;
    if (rounded < 10_000 || index === units.length - 1) return {value: String(rounded), unit};
  }
  return {value: String(count), unit: ''};
}

export function formatCompactCount(value: number): string {
  const parts = compactCountParts(value);
  return parts.value + parts.unit;
}

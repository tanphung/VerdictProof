const ATTO_PER_GEN = 10n ** 18n;

export function parseGen(value: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) return 0n;
  const [wholeRaw, fracRaw = ""] = trimmed.split(".");
  const whole = BigInt(wholeRaw || "0");
  const frac = (fracRaw + "0".repeat(18)).slice(0, 18);
  return whole * ATTO_PER_GEN + BigInt(frac || "0");
}

export function formatGen(value: bigint | string | number): string {
  const atto = typeof value === "bigint" ? value : BigInt(value || 0);
  const whole = atto / ATTO_PER_GEN;
  const frac = (atto % ATTO_PER_GEN).toString().padStart(18, "0");
  const short = frac.slice(0, 4).replace(/0+$/, "");
  return `${whole.toString()}${short ? `.${short}` : ""} GEN`;
}

export function shortAddress(value: string): string {
  if (!value) return "Not connected";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function scoreLabel(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 75) return "Approved";
  if (score >= 50) return "Needs proof";
  return "Low signal";
}

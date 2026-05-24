const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function money(value) {
  const n = Number(value) || 0;
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${nf.format(Math.abs(n))}`;
}

export function usd(value) {
  return `$${nf.format(Math.abs(Number(value) || 0))}`;
}

export function sol(value, digits = 3) {
  return `${(Number(value) || 0).toFixed(digits)} SOL`;
}

export function pct(value, digits = 1) {
  const n = Number(value) || 0;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function age(iso) {
  if (!iso) return "-";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function shortId(value, head = 6, tail = 4) {
  if (!value) return "-";
  const text = String(value);
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

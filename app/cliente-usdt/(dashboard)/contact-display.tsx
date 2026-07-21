export const NETWORK_STYLE: Record<string, string> = {
  TRC20: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  ERC20: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  BEP20: "border-amber-400/30 bg-amber-400/10 text-amber-300",
};

const AVATAR_COLORS = [
  "bg-emerald-400/15 text-emerald-300",
  "bg-sky-400/15 text-sky-300",
  "bg-violet-400/15 text-violet-300",
  "bg-amber-400/15 text-amber-300",
  "bg-rose-400/15 text-rose-300",
  "bg-teal-400/15 text-teal-300",
];

export function avatarColor(alias: string) {
  let hash = 0;
  for (let i = 0; i < alias.length; i++) hash = (hash * 31 + alias.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function initials(alias: string) {
  const parts = alias.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function shortAddress(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-5)}`;
}

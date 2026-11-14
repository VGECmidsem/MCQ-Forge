// Pure helper utilities shared by server and client (no Node-only imports).

export const LETTERS: string[] = ["A", "B", "C", "D", "E", "F"];

export function presentedLetters(count: number): string[] {
  return LETTERS.slice(0, Math.min(count, LETTERS.length));
}

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function fingerprintOf(text: string, options: Record<string, string>): string {
  const opt = Object.keys(options)
    .sort()
    .map((k) => normalizeText(options[k]))
    .join(" | ");
  return normalizeText(text) + " :: " + opt;
}

export function jaccardSimilarity(a: string, b: string): number {
  const sa = new Set(normalizeText(a).split(" ").filter(Boolean));
  const sb = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function uid(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// --- CSV -------------------------------------------------------------------
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCSV(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  return lines.join("\r\n");
}

// --- naive topic classification -------------------------------------------
const TOPIC_KEYWORDS: Array<[string, string[]]> = [
  ["Physics", ["velocity", "acceleration", "newton", "voltage", "current", "circuit", "resistance", "ohm", "lens", "mirror", "kinetic", "projectile", "torque", "photon", "capacitor", "wavelength", "frequency", "pendulum", "magnet", "joule", "watt", "overcurrent", "breaker"]],
  ["Chemistry", ["mole", "electron", "element", "acid", "base", "oxidation", "catalyst", "bond", "isotope", "titration", "compound", "polymer", "electrolyte", "valence", "periodic", "solution", "gas"]],
  ["Biology", ["cell", "dna", "enzyme", "neuron", "species", "photosynthesis", "chromosome", "hormone", "bacteria", "virus", "tissue", "ecosystem", "digestion", "respiration", "genetic", "plant", "animal"]],
  ["Mathematics", ["integral", "derivative", "equation", "probability", "vector", "matrix", "polynomial", "theorem", "angle", "triangle", "ratio", "logarithm", "function", "slope", "calculus", "algebra", "integer"]],
  ["Computer Science", ["algorithm", "database", "binary", "compiler", "network", "protocol", "recursion", "cache", "encryption", "server", "html", "pointer", "array", "software", "computer", "tcp", "data structure"]],
  ["History & Polity", ["empire", "revolution", "treaty", "dynasty", "war", "ancient", "civilization", "parliament", "constitution", "colony", "independence", "president", "amendment"]],
  ["Geography", ["river", "mountain", "climate", "ocean", "latitude", "desert", "tectonic", "monsoon", "glacier", "delta", "plateau", "rainfall", "continent"]],
  ["Economics", ["economy", "inflation", "budget", "gdp", "currency", "market", "demand", "supply", "fiscal", "monetary", "tax"]],
  ["English", ["synonym", "antonym", "grammar", "sentence", "idiom", "verb", "noun", "adjective", "tense", "passage"]],
  ["Reasoning", ["series", "pattern", "analogy", "code", "direction", "blood relation", "puzzle", "sequence", "odd one"]],
];

export function classifyTopic(text: string): string | null {
  const t = " " + normalizeText(text) + " ";
  let best: string | null = null;
  let bestScore = 0;
  for (const [topic, words] of TOPIC_KEYWORDS) {
    let score = 0;
    for (const w of words) {
      if (t.includes(" " + w)) score += w.includes(" ") ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }
  return bestScore >= 2 ? best : null;
}

export const ANSWER_SOURCE_LABEL: Record<string, string> = {
  pdf_answer_key: "PDF answer key",
  pdf_marked: "Marked in PDF",
  ai_generated: "AI generated",
  manual: "Manual",
  none: "Unresolved",
};

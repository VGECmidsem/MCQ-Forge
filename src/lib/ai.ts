// Server-side LLM integration used only when a PDF provides no answer key and
// no marked answers. Supports Google Gemini or any OpenAI-compatible API via
// environment variables. API keys never leave the server.

export interface AiAnswer {
  id: string;
  answer: string; // A-E or "unknown"
  explanation: string | null;
}

export interface AiConfigStatus {
  configured: boolean;
  provider: "gemini" | "openai" | null;
  model: string | null;
}

export function aiConfigStatus(): AiConfigStatus {
  if (process.env.GEMINI_API_KEY) {
    return {
      configured: true,
      provider: "gemini",
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      configured: true,
      provider: "openai",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    };
  }
  return { configured: false, provider: null, model: null };
}

interface QuestionPayload {
  id: string;
  text: string;
  options: Record<string, string>;
}

function buildPrompt(questions: QuestionPayload[]): string {
  const list = questions
    .map((q, i) => {
      const opts = Object.entries(q.options)
        .map(([k, v]) => `  ${k}. ${v}`)
        .join("\n");
      return `Question ${i + 1} (id: ${q.id}):\n${q.text}\n${opts}`;
    })
    .join("\n\n");
  return [
    "You are a meticulous subject-matter expert solving multiple-choice questions.",
    "For EACH question, determine the single most likely correct option.",
    "Rules:",
    '- Answer must be one of the option letters shown for that question, or "unknown" if you are not reasonably confident.',
    "- Provide a concise explanation (max 40 words) that justifies the answer against the question and options.",
    "- Never default to option A or any fixed pattern; solve each question on its own merits.",
    'Respond with STRICT JSON only, no markdown fences: {"answers":[{"id":"<id>","answer":"A","explanation":"..."}]}',
    "",
    list,
  ].join("\n");
}

function extractJson(text: string): any {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* continue */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* continue */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* continue */
    }
  }
  throw new Error("AI returned an unreadable response.");
}

async function callGemini(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY!;
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content.");
  return String(text);
}

async function callOpenAI(prompt: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY!;
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a precise exam solver. Answer with valid JSON only." },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI-compatible API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("AI returned no content.");
  return String(text);
}

export async function solveQuestionsWithAi(questions: QuestionPayload[]): Promise<AiAnswer[]> {
  const status = aiConfigStatus();
  if (!status.configured) {
    throw new Error(
      "No AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY in environment variables to enable AI answer generation.",
    );
  }
  const prompt = buildPrompt(questions);
  const raw = status.provider === "gemini" ? await callGemini(prompt) : await callOpenAI(prompt);
  const parsed = extractJson(raw);
  const answers: any[] = Array.isArray(parsed?.answers)
    ? parsed.answers
    : Array.isArray(parsed)
      ? parsed
      : [];
  return answers
    .map((a) => ({
      id: String(a?.id ?? ""),
      answer: String(a?.answer ?? "unknown").trim().toUpperCase(),
      explanation:
        typeof a?.explanation === "string" && a.explanation.trim() ? a.explanation.trim() : null,
    }))
    .filter((a) => a.id);
}

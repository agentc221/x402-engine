import { keyPool } from "../lib/key-pool.js";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function openrouterFetch(path: string, body: any): Promise<any> {
  const key = keyPool.acquire("openrouter");
  if (!key) {
    throw Object.assign(new Error("OpenRouter not configured"), { status: 502 });
  }

  const url = `${OPENROUTER_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://x402engine.app",
    "X-Title": "x402engine",
  };

  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200;
      console.warn(`[openrouter] retry ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms`);
      await sleep(delay);
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (res.status >= 500 && attempt < MAX_RETRIES) {
        lastErr = Object.assign(new Error(`OpenRouter ${res.status}`), { status: res.status });
        continue;
      }

      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.error?.message || "OpenRouter API error"), {
          status: res.status,
          upstream: data,
        });
      }
      return data;
    } catch (err: any) {
      if ((err.status >= 500 || err.name === "TimeoutError") && attempt < MAX_RETRIES) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

export async function chatCompletion(
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number = 1024,
  reasoning?: boolean,
): Promise<{ content: string; model: string; usage: any; reasoning_content?: string }> {
  // Reasoning models use max_completion_tokens (covers reasoning + output).
  // Sending max_tokens to reasoning models caps output only, and the reasoning
  // chain consumes it all — leaving empty content.
  const tokenParam = reasoning
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };

  const data = await openrouterFetch("/chat/completions", {
    model,
    messages,
    ...tokenParam,
  });

  const choice = data.choices?.[0]?.message;
  return {
    content: choice?.content ?? "",
    reasoning_content: choice?.reasoning_content || undefined,
    model: data.model,
    usage: data.usage,
  };
}

export async function createEmbedding(
  texts: string[],
): Promise<number[][]> {
  const data = await openrouterFetch("/embeddings", {
    model: "openai/text-embedding-3-small",
    input: texts,
  });

  return data.data.map((item: any) => item.embedding);
}

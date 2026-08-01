import { Router, type Request, type Response } from "express";
import { chatCompletion, createEmbedding } from "../providers/openrouter.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

interface ModelConfig {
  model: string;
  serviceId: string;
  reasoning?: boolean; // reasoning models need higher token limits (reasoning eats into max_tokens)
}

const MODELS: Record<string, ModelConfig> = {
  // OpenAI
  "gpt-4o": { model: "openai/gpt-4o", serviceId: "llm-gpt-4o" },
  "gpt-4o-mini": { model: "openai/gpt-4o-mini", serviceId: "llm-gpt-4o-mini" },
  "o1": { model: "openai/o1", serviceId: "llm-o1", reasoning: true },
  // Anthropic
  "claude-opus": { model: "anthropic/claude-opus-4.6", serviceId: "llm-claude-opus" },
  "claude-sonnet": { model: "anthropic/claude-sonnet-4.5", serviceId: "llm-claude-sonnet" },
  "claude-haiku": { model: "anthropic/claude-haiku-4.5", serviceId: "llm-claude-haiku" },
  // Google
  "gemini-pro": { model: "google/gemini-2.5-pro", serviceId: "llm-gemini-pro", reasoning: true },
  "gemini-flash": { model: "google/gemini-2.5-flash", serviceId: "llm-gemini-flash" },
  // DeepSeek
  "deepseek": { model: "deepseek/deepseek-chat", serviceId: "llm-deepseek" },
  "deepseek-r1": { model: "deepseek/deepseek-r1", serviceId: "llm-deepseek-r1", reasoning: true },
  // Meta
  "llama": { model: "meta-llama/llama-3.3-70b-instruct", serviceId: "llm-llama" },
  // xAI
  "grok": { model: "x-ai/grok-4.3", serviceId: "llm-grok" },
  // Qwen
  "qwen": { model: "qwen/qwen-2.5-72b-instruct", serviceId: "llm-qwen" },
  // Mistral
  "mistral": { model: "mistralai/mistral-large", serviceId: "llm-mistral" },
  // Perplexity (search-augmented)
  "perplexity": { model: "perplexity/sonar-pro", serviceId: "llm-perplexity" },
  // OpenAI (newer)
  "gpt-5.2": { model: "openai/gpt-5.2", serviceId: "llm-gpt-5.2" },
  "gpt-5.2-codex": { model: "openai/gpt-5.2-codex", serviceId: "llm-gpt-5.2-codex", reasoning: true },
  // Moonshot
  "kimi": { model: "moonshotai/kimi-k2.5", serviceId: "llm-kimi" },
  // MiniMax
  "minimax": { model: "minimax/minimax-m2.5", serviceId: "llm-minimax" },
  // Zhipu
  "glm": { model: "z-ai/glm-5", serviceId: "llm-glm" },
  // xAI (code-focused)
  "grok-code": { model: "x-ai/grok-build-0.1", serviceId: "llm-grok-code" },
  // ByteDance
  "seed": { model: "bytedance-seed/seed-1.6", serviceId: "llm-seed" },
  // Mistral (code-focused)
  "devstral": { model: "mistralai/devstral-2512", serviceId: "llm-devstral" },
  // DeepSeek (newer)
  "deepseek-v3.2": { model: "deepseek/deepseek-v3.2", serviceId: "llm-deepseek-v3.2" },
  "deepseek-v4-flash": { model: "deepseek/deepseek-v4-flash", serviceId: "llm-deepseek-v4-flash", reasoning: true },
  "deepseek-v4-flash-0731": { model: "deepseek/deepseek-v4-flash-0731", serviceId: "llm-deepseek-v4-flash-0731", reasoning: true },
  "deepseek-v4-pro": { model: "deepseek/deepseek-v4-pro", serviceId: "llm-deepseek-v4-pro", reasoning: true },
  // Google (newer)
  "gemini-3-pro": { model: "google/gemini-3.1-pro-preview", serviceId: "llm-gemini-3-pro", reasoning: true },
  "gemini-3-flash": { model: "google/gemini-3-flash-preview", serviceId: "llm-gemini-3-flash" },
  // Anthropic (newer)
  "claude-sonnet-4.6": { model: "anthropic/claude-sonnet-4.6", serviceId: "llm-claude-sonnet-4.6" },
  // OpenAI (newer)
  "gpt-5.2-pro": { model: "openai/gpt-5.2-pro", serviceId: "llm-gpt-5.2-pro", reasoning: true },
  "gpt-5.1": { model: "openai/gpt-5.1", serviceId: "llm-gpt-5.1" },
  "gpt-5-nano": { model: "openai/gpt-5-nano", serviceId: "llm-gpt-5-nano" },
  "o4-mini": { model: "openai/o4-mini", serviceId: "llm-o4-mini", reasoning: true },
  // Qwen (code-focused)
  "qwen-coder": { model: "qwen/qwen3-coder-next", serviceId: "llm-qwen-coder" },
  // OpenAI (latest)
  "gpt-5.4": { model: "openai/gpt-5.4", serviceId: "llm-gpt-5.4" },
  "gpt-5.4-pro": { model: "openai/gpt-5.4-pro", serviceId: "llm-gpt-5.4-pro", reasoning: true },
  "gpt-5.3-codex": { model: "openai/gpt-5.3-codex", serviceId: "llm-gpt-5.3-codex", reasoning: true },
  // Anthropic (previous-gen)
  "claude-opus-4.5": { model: "anthropic/claude-opus-4.5", serviceId: "llm-claude-opus-4.5" },
  "claude-opus-4.8": { model: "anthropic/claude-opus-4.8", serviceId: "llm-claude-opus-4.8" },
  // Google (latest)
  "gemini-3.1-pro": { model: "google/gemini-3.1-pro-preview", serviceId: "llm-gemini-3.1-pro", reasoning: true },
  "gemini-3.1-flash-lite": { model: "google/gemini-3.1-flash-lite-preview", serviceId: "llm-gemini-3.1-flash-lite" },
  // Qwen (latest)
  "qwen3.5": { model: "qwen/qwen3.5-plus-02-15", serviceId: "llm-qwen3.5" },
  "qwen3.7-plus": { model: "qwen/qwen3.7-plus", serviceId: "llm-qwen3.7-plus", reasoning: true },
  "qwen3.7-max": { model: "qwen/qwen3.7-max", serviceId: "llm-qwen3.7-max", reasoning: true },
  // DeepSeek (enhanced reasoning)
  "deepseek-v3.2-speciale": { model: "deepseek/deepseek-v3.2", serviceId: "llm-deepseek-v3.2-speciale", reasoning: true },
  // MiniMax (newer)
  "minimax-m2.7": { model: "minimax/minimax-m2.7", serviceId: "llm-minimax-m2.7" },
  "minimax-m3": { model: "minimax/minimax-m3", serviceId: "llm-minimax-m3" },
  // Meta (newer)
  "llama-4-maverick": { model: "meta-llama/llama-4-maverick", serviceId: "llm-llama-4-maverick" },
  // Cohere
  "command-a": { model: "cohere/command-a", serviceId: "llm-command-a" },
  // Zhipu
  "glm-5.2": { model: "z-ai/glm-5.2", serviceId: "llm-glm-5.2", reasoning: true },
  // OpenAI (GPT-5.6)
  "gpt-5.6-luna": { model: "openai/gpt-5.6-luna", serviceId: "llm-gpt-5.6-luna", reasoning: true },
  "gpt-5.6-luna-pro": { model: "openai/gpt-5.6-luna-pro", serviceId: "llm-gpt-5.6-luna-pro", reasoning: true },
  "gpt-5.6-terra": { model: "openai/gpt-5.6-terra", serviceId: "llm-gpt-5.6-terra", reasoning: true },
  "gpt-5.6-terra-pro": { model: "openai/gpt-5.6-terra-pro", serviceId: "llm-gpt-5.6-terra-pro", reasoning: true },
  "gpt-5.6-sol": { model: "openai/gpt-5.6-sol", serviceId: "llm-gpt-5.6-sol", reasoning: true },
  "gpt-5.6-sol-pro": { model: "openai/gpt-5.6-sol-pro", serviceId: "llm-gpt-5.6-sol-pro", reasoning: true },
  // Anthropic (Claude 5)
  "claude-opus-5": { model: "anthropic/claude-opus-5", serviceId: "llm-claude-opus-5" },
  "claude-opus-5-fast": { model: "anthropic/claude-opus-5-fast", serviceId: "llm-claude-opus-5-fast" },
  "claude-sonnet-5": { model: "anthropic/claude-sonnet-5", serviceId: "llm-claude-sonnet-5" },
  // Google
  "gemini-3.6-flash": { model: "google/gemini-3.6-flash", serviceId: "llm-gemini-3.6-flash" },
  "gemini-3.5-flash-lite": { model: "google/gemini-3.5-flash-lite", serviceId: "llm-gemini-3.5-flash-lite" },
  // Moonshot
  "kimi-k3": { model: "moonshotai/kimi-k3", serviceId: "llm-kimi-k3" },
  // xAI
  "grok-4.5": { model: "x-ai/grok-4.5", serviceId: "llm-grok-4.5" },
  // Coding
  "kat-coder-air-v2.5": { model: "kwaipilot/kat-coder-air-v2.5", serviceId: "llm-kat-coder-air-v2.5" },
  "kat-coder-pro-v2.5": { model: "kwaipilot/kat-coder-pro-v2.5", serviceId: "llm-kat-coder-pro-v2.5" },
  // Additional frontier and open models
  "longcat-2": { model: "meituan/longcat-2.0", serviceId: "llm-longcat-2" },
  "inkling": { model: "thinkingmachines/inkling", serviceId: "llm-inkling" },
  "muse-spark-1.1": { model: "meta/muse-spark-1.1", serviceId: "llm-muse-spark-1.1" },
  "aion-3.0": { model: "aion-labs/aion-3.0", serviceId: "llm-aion-3.0" },
  "aion-3.0-mini": { model: "aion-labs/aion-3.0-mini", serviceId: "llm-aion-3.0-mini" },
  "hy3": { model: "tencent/hy3", serviceId: "llm-hy3" },
  "ling-3-flash": { model: "inclusionai/ling-3.0-flash:free", serviceId: "llm-ling-3-flash" },
};

// Reasoning models burn tokens on chain-of-thought before generating content.
// On OpenRouter, reasoning tokens count against max_tokens, so we need higher
// defaults and caps to ensure non-empty output.
const TOKEN_DEFAULTS = { default: 1024, max: 4096 } as const;
const TOKEN_REASONING = { default: 16384, max: 65536 } as const;

function chatHandler(slug: string) {
  const { model, serviceId, reasoning } = MODELS[slug];
  const endpoint = `/api/llm/${slug}`;
  const limits = reasoning ? TOKEN_REASONING : TOKEN_DEFAULTS;

  return async (req: Request, res: Response) => {
    const { messages, max_tokens } = req.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "Provide 'messages' array with at least one message" });
      return;
    }

    for (const msg of messages) {
      if (!msg.role || !msg.content || typeof msg.content !== "string") {
        res.status(400).json({ error: "Each message must have 'role' and 'content' (string)" });
        return;
      }
      if (msg.content.length > 100_000) {
        res.status(400).json({ error: "Message content exceeds 100k character limit" });
        return;
      }
    }

    if (messages.length > 100) {
      res.status(400).json({ error: "Maximum 100 messages per request" });
      return;
    }

    const maxTokens = Math.min(Math.max(parseInt(max_tokens) || limits.default, 1), limits.max);

    const start = Date.now();
    let upstreamStatus = 0;

    try {
      const result = await chatCompletion(model, messages, maxTokens, reasoning);
      upstreamStatus = 200;
      res.json(result);
    } catch (err: any) {
      upstreamStatus = err.status || 500;
      console.error(`[${serviceId}] upstream error: status=${upstreamStatus} message=${err.message}`);
      res.setHeader("Retry-After", "5");
      res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
    } finally {
      logRequest({
        service: serviceId,
        endpoint,
        payer: (req as any).x402?.payer,
        network: (req as any).x402?.network,
        amount: (req as any).x402?.amount,
        upstreamStatus,
        latencyMs: Date.now() - start,
      });
    }
  };
}

// Register all LLM chat endpoints
for (const slug of Object.keys(MODELS)) {
  router.post(`/api/llm/${slug}`, chatHandler(slug));
}

// Embeddings endpoint
router.post("/api/embeddings", async (req: Request, res: Response) => {
  const { text, texts } = req.body || {};

  let inputTexts: string[];
  if (texts && Array.isArray(texts)) {
    if (texts.length === 0 || texts.length > 100) {
      res.status(400).json({ error: "Provide 1-100 texts in 'texts' array" });
      return;
    }
    for (const t of texts) {
      if (typeof t !== "string" || t.length === 0 || t.length > 50_000) {
        res.status(400).json({ error: "Each text must be a non-empty string (max 50k chars)" });
        return;
      }
    }
    inputTexts = texts;
  } else if (text && typeof text === "string") {
    if (text.length === 0 || text.length > 50_000) {
      res.status(400).json({ error: "Text must be non-empty (max 50k chars)" });
      return;
    }
    inputTexts = [text];
  } else {
    res.status(400).json({ error: "Provide 'text' (string) or 'texts' (array of strings)" });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const embeddings = await createEmbedding(inputTexts);
    upstreamStatus = 200;

    if (inputTexts.length === 1 && !texts) {
      res.json({ embedding: embeddings[0] });
    } else {
      res.json({ embeddings });
    }
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[embeddings] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "embeddings",
      endpoint: "/api/embeddings",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;

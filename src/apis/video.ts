import { Router, type Request, type Response } from "express";
import { generateVideo } from "../providers/fal.js";
import { logRequest } from "../db/ledger.js";
import { isPublicUrl } from "../lib/validation.js";

const router = Router();

interface VideoModelConfig {
  modelId: string;
  serviceId: string;
  fixedDuration?: string;
  aspectRatios?: readonly string[];
  requiresStartImage?: boolean;
  supportsNegativePrompt?: boolean;
  generateAudio?: boolean;
  promptOptimizer?: boolean;
}

export const VIDEO_MODELS: Record<string, VideoModelConfig> = {
  fast: {
    modelId: "fal-ai/kling-video/v3/standard/text-to-video",
    serviceId: "video-fast",
    fixedDuration: "5",
    aspectRatios: ["16:9", "9:16", "1:1"],
    supportsNegativePrompt: true,
    generateAudio: false,
  },
  quality: {
    modelId: "fal-ai/kling-video/v3/pro/text-to-video",
    serviceId: "video-quality",
    fixedDuration: "5",
    aspectRatios: ["16:9", "9:16", "1:1"],
    supportsNegativePrompt: true,
    generateAudio: false,
  },
  hailuo: {
    modelId: "fal-ai/minimax/hailuo-2.3/pro/text-to-video",
    serviceId: "video-hailuo",
    promptOptimizer: true,
  },
  animate: {
    modelId: "fal-ai/kling-video/v3/pro/image-to-video",
    serviceId: "video-animate",
    fixedDuration: "5",
    requiresStartImage: true,
    supportsNegativePrompt: true,
    generateAudio: false,
  },
};

function videoHandler(slug: string) {
  const cfg = VIDEO_MODELS[slug];
  const endpoint = `/api/video/${slug}`;

  return async (req: Request, res: Response) => {
    const {
      prompt,
      duration,
      aspect_ratio,
      image_url,
      negative_prompt,
      generate_audio,
    } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt is required (string)" });
      return;
    }
    if (prompt.length > 2000) {
      res.status(400).json({ error: "prompt must be under 2000 characters" });
      return;
    }

    if (cfg.requiresStartImage && (!image_url || typeof image_url !== "string")) {
      res.status(400).json({ error: "image_url is required (string) for image-to-video" });
      return;
    }

    if (duration !== undefined && (!cfg.fixedDuration || String(duration) !== cfg.fixedDuration)) {
      res.status(400).json({
        error: cfg.fixedDuration
          ? `duration is fixed at ${cfg.fixedDuration} seconds for this endpoint`
          : "duration is not configurable for this endpoint",
      });
      return;
    }
    if (
      aspect_ratio !== undefined &&
      (!cfg.aspectRatios || typeof aspect_ratio !== "string" || !cfg.aspectRatios.includes(aspect_ratio))
    ) {
      res.status(400).json({
        error: cfg.aspectRatios
          ? `aspect_ratio must be ${cfg.aspectRatios.join(", ")}`
          : "aspect_ratio is not configurable for this endpoint",
      });
      return;
    }
    if (negative_prompt !== undefined && (!cfg.supportsNegativePrompt || typeof negative_prompt !== "string")) {
      res.status(400).json({
        error: cfg.supportsNegativePrompt
          ? "negative_prompt must be a string"
          : "negative_prompt is not supported for this endpoint",
      });
      return;
    }
    if (generate_audio !== undefined && generate_audio !== cfg.generateAudio) {
      res.status(400).json({
        error: cfg.generateAudio
          ? "generate_audio is fixed to true for this endpoint"
          : "generate_audio is fixed to false for this endpoint",
      });
      return;
    }

    let startImageUrl: string | undefined;
    if (cfg.requiresStartImage) {
      const checked = await isPublicUrl(image_url);
      if (!checked.valid) {
        res.status(400).json({ error: `image_url: ${checked.reason}` });
        return;
      }
      startImageUrl = checked.url;
    }

    const start = Date.now();
    let upstreamStatus = 0;

    try {
      const result = await generateVideo({
        prompt,
        modelId: cfg.modelId,
        duration: cfg.fixedDuration,
        aspect_ratio: cfg.aspectRatios ? (aspect_ratio || "16:9") : undefined,
        start_image_url: startImageUrl,
        negative_prompt: cfg.supportsNegativePrompt ? negative_prompt : undefined,
        generate_audio: cfg.generateAudio,
        prompt_optimizer: cfg.promptOptimizer,
      });
      upstreamStatus = 200;
      res.json(result);
    } catch (err: any) {
      upstreamStatus = err.status || 500;
      console.error(`[${cfg.serviceId}] upstream error: status=${upstreamStatus} message=${err.message}`);
      if (upstreamStatus === 403) {
        res.status(503).json({ error: "Video generation temporarily unavailable (upstream auth)", retryable: false });
      } else {
        res.setHeader("Retry-After", "10");
        res.status(503).json({ error: "Video generation failed", retryable: true });
      }
    } finally {
      logRequest({
        service: cfg.serviceId,
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

for (const slug of Object.keys(VIDEO_MODELS)) {
  router.post(`/api/video/${slug}`, videoHandler(slug));
}

export default router;

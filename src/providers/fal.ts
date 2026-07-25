import { fal } from "@fal-ai/client";
import { config } from "../config.js";
import { keyPool } from "../lib/key-pool.js";

export function initFal(): void {
  if (!keyPool.has("fal")) {
    console.log("  fal.ai API key not configured — image/video endpoints will return 502");
    return;
  }
  // Configure with the first key — will be rotated per-request
  const firstKey = keyPool.acquire("fal");
  if (firstKey) fal.config({ credentials: firstKey });
  console.log(`  fal.ai client configured (${keyPool.count("fal")} key${keyPool.count("fal") > 1 ? "s" : ""})`);
}

export interface ImageGenerationRequest {
  prompt: string;
  model: "fast" | "quality" | "text" | "face-swap" | "nano-banana";
  modelId?: string;
  width?: number;
  height?: number;
  seed?: number;
  image_url?: string;
  reference_image_url?: string;
  negative_prompt?: string;
  guidance_scale?: number;
  start_step?: number;
  true_cfg?: number;
  id_weight?: number;
  enable_safety_checker?: boolean;
  max_sequence_length?: "128" | "256" | "512";
  aspect_ratio?: string;
  output_format?: string;
}

export interface ImageGenerationResponse {
  images: Array<{ url: string; width: number; height: number }>;
  seed: number;
  model: string;
  inference_time_ms: number;
}

const MODEL_MAP: Record<string, string> = {
  fast: config.computeProviders.fal.models.fast,
  quality: config.computeProviders.fal.models.quality,
  text: config.computeProviders.fal.models.text,
  "face-swap": "fal-ai/flux-pulid",
  "nano-banana": "fal-ai/nano-banana-2",
};

export async function generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  const apiKey = keyPool.acquire("fal");
  if (!apiKey) {
    throw Object.assign(new Error("fal.ai not configured"), { status: 502 });
  }

  // Rotate key before each call. fal.ai SDK is a singleton, but image
  // generation takes 2-10s so concurrent contention is rare.
  fal.config({ credentials: apiKey });

  const modelId = req.modelId || MODEL_MAP[req.model] || MODEL_MAP.fast;
  const start = Date.now();

  const imageSize = {
    width: req.width || 1024,
    height: req.height || 1024,
  };
  const isFaceSwap = modelId === MODEL_MAP["face-swap"];
  const isNanoBanana = modelId === MODEL_MAP["nano-banana"];

  let input: Record<string, any>;
  if (isNanoBanana) {
    input = {
      prompt: req.prompt,
      aspect_ratio: req.aspect_ratio || "1:1",
      num_images: 1,
      output_format: req.output_format || "png",
    };
    if (req.seed !== undefined) input.seed = req.seed;
    if (req.negative_prompt) input.negative_prompt = req.negative_prompt;
  } else if (isFaceSwap) {
    const referenceImageUrl = req.reference_image_url || req.image_url;
    if (!referenceImageUrl) {
      throw Object.assign(new Error("reference_image_url is required for face-swap"), { status: 400 });
    }

    input = {
      prompt: req.prompt,
      reference_image_url: referenceImageUrl,
      image_size: imageSize,
    };
    if (req.seed !== undefined) input.seed = req.seed;
    if (req.negative_prompt) input.negative_prompt = req.negative_prompt;
    if (req.guidance_scale !== undefined) input.guidance_scale = req.guidance_scale;
    if (req.start_step !== undefined) input.start_step = req.start_step;
    if (req.true_cfg !== undefined) input.true_cfg = req.true_cfg;
    if (req.id_weight !== undefined) input.id_weight = req.id_weight;
    if (req.enable_safety_checker !== undefined) input.enable_safety_checker = req.enable_safety_checker;
    if (req.max_sequence_length) input.max_sequence_length = req.max_sequence_length;
  } else {
    input = {
      prompt: req.prompt,
      image_size: imageSize,
      seed: req.seed,
      num_images: 1,
    };
  }

  const result = await fal.subscribe(modelId, {
    input,
  });

  const data = result.data as any;

  return {
    images: (data.images || []).map((img: any) => ({
      url: img.url,
      width: img.width || req.width || 1024,
      height: img.height || req.height || 1024,
    })),
    seed: data.seed ?? 0,
    model: modelId,
    inference_time_ms: Date.now() - start,
  };
}

// ── Lux TTS (Voice Cloning) ─────────────────────────────────────────

export interface LuxTTSRequest {
  prompt: string;
  audio_url: string;
  num_inference_steps?: number;
  max_ref_length?: number;
  guidance_scale?: number;
  seed?: number;
}

export interface LuxTTSResponse {
  audio: { url: string; content_type?: string; file_size?: number };
  seed: number;
  inference_time_ms: number;
}

export async function generateLuxTTS(req: LuxTTSRequest): Promise<LuxTTSResponse> {
  const apiKey = keyPool.acquire("fal");
  if (!apiKey) {
    throw Object.assign(new Error("fal.ai not configured"), { status: 502 });
  }

  fal.config({ credentials: apiKey });

  const input: Record<string, any> = {
    prompt: req.prompt,
    audio_url: req.audio_url,
  };
  if (req.num_inference_steps !== undefined) input.num_inference_steps = req.num_inference_steps;
  if (req.max_ref_length !== undefined) input.max_ref_length = req.max_ref_length;
  if (req.guidance_scale !== undefined) input.guidance_scale = req.guidance_scale;
  if (req.seed !== undefined) input.seed = req.seed;

  const start = Date.now();

  const result = await fal.subscribe("fal-ai/lux-tts", { input });
  const data = result.data as any;

  return {
    audio: {
      url: data.audio?.url,
      content_type: data.audio?.content_type || "audio/wav",
      file_size: data.audio?.file_size,
    },
    seed: data.seed ?? 0,
    inference_time_ms: Date.now() - start,
  };
}

// ── Video Generation ────────────────────────────────────────────────

export interface VideoGenerationRequest {
  prompt: string;
  modelId: string;
  duration?: string;
  aspect_ratio?: string;
  start_image_url?: string;
  negative_prompt?: string;
  generate_audio?: boolean;
  prompt_optimizer?: boolean;
}

export interface VideoGenerationResponse {
  video: { url: string; content_type?: string; file_size?: number };
  model: string;
  inference_time_ms: number;
}

export async function generateVideo(req: VideoGenerationRequest): Promise<VideoGenerationResponse> {
  const apiKey = keyPool.acquire("fal");
  if (!apiKey) {
    throw Object.assign(new Error("fal.ai not configured"), { status: 502 });
  }

  fal.config({ credentials: apiKey });

  const input: Record<string, any> = { prompt: req.prompt };
  if (req.duration) input.duration = req.duration;
  if (req.aspect_ratio) input.aspect_ratio = req.aspect_ratio;
  if (req.start_image_url) input.start_image_url = req.start_image_url;
  if (req.negative_prompt) input.negative_prompt = req.negative_prompt;
  if (req.generate_audio !== undefined) input.generate_audio = req.generate_audio;
  if (req.prompt_optimizer !== undefined) input.prompt_optimizer = req.prompt_optimizer;

  const start = Date.now();

  const result = await fal.subscribe(req.modelId, { input });
  const data = result.data as any;

  const video = data.video || {};
  if (!video.url || typeof video.url !== "string") {
    throw Object.assign(new Error("fal.ai returned no video URL"), { status: 502 });
  }

  return {
    video: {
      url: video.url,
      content_type: video.content_type || "video/mp4",
      file_size: video.file_size,
    },
    model: req.modelId,
    inference_time_ms: Date.now() - start,
  };
}

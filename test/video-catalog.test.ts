import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Service = {
  id: string;
  path: string;
  price: string;
  cost?: string;
  upstream: {
    baseUrl: string;
  };
};

const services = JSON.parse(readFileSync("config/services.json", "utf8")).services as Service[];
const videoServices = services.filter((service) => service.path.startsWith("/api/video/"));
const videoSource = readFileSync("src/apis/video.ts", "utf8");
const falSource = readFileSync("src/providers/fal.ts", "utf8");

const expectedVideos = {
  "video-fast": {
    path: "/api/video/fast",
    model: "fal-ai/kling-video/v3/standard/text-to-video",
  },
  "video-quality": {
    path: "/api/video/quality",
    model: "fal-ai/kling-video/v3/pro/text-to-video",
  },
  "video-hailuo": {
    path: "/api/video/hailuo",
    model: "fal-ai/minimax/hailuo-2.3/pro/text-to-video",
  },
  "video-animate": {
    path: "/api/video/animate",
    model: "fal-ai/kling-video/v3/pro/image-to-video",
  },
};

describe("video catalog", () => {
  it("registers every video route in the paid service catalog", () => {
    expect(
      Object.fromEntries(videoServices.map((service) => [
        service.id,
        {
          path: service.path,
          model: service.upstream.baseUrl.replace("https://fal.run/", ""),
        },
      ])),
    ).toEqual(expectedVideos);

    for (const serviceId of Object.keys(expectedVideos)) {
      expect(videoSource).toContain(`serviceId: "${serviceId}"`);
    }
  });

  it("prices every route above its bounded upstream cost", () => {
    for (const service of videoServices) {
      expect(Number(service.price.slice(1))).toBeGreaterThan(Number(service.cost?.slice(1)));
    }

    expect(videoSource).toContain('fixedDuration: "5"');
    expect(videoSource).toContain("generateAudio: false");
  });

  it("uses fal's current start-image field for Kling V3 animation", () => {
    expect(videoSource).toContain("start_image_url: startImageUrl");
    expect(falSource).toContain("input.start_image_url = req.start_image_url");
    expect(falSource).not.toContain("input.image_url = req.image_url");
  });

  it("documents every active video route on public catalog surfaces", () => {
    const publicCatalogs = [
      readFileSync("public/index.html", "utf8"),
      readFileSync("public/docs/index.html", "utf8"),
      readFileSync("public/llms.txt", "utf8"),
    ];

    for (const video of Object.values(expectedVideos)) {
      for (const catalog of publicCatalogs) {
        expect(catalog).toContain(video.path);
      }
    }
  });
});

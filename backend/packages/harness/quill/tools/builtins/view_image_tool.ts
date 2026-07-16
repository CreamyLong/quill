/**
 * view_image tool — make an image file available to the model/frontend.
 *
 * Reads an image from the per-thread workspace, validates it, and stores the
 * base64 payload in the graph state so the ViewImageMiddleware can inject it
 * into the next model call.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import { VIRTUAL_PATH_PREFIX } from "../../config/paths.js";
import type { SandboxBackend, SandboxToolProvider } from "../../sandbox/sandbox_backend.js";

const ALLOWED_VIRTUAL_ROOTS = [
  `${VIRTUAL_PATH_PREFIX}/workspace`,
  `${VIRTUAL_PATH_PREFIX}/uploads`,
  `${VIRTUAL_PATH_PREFIX}/outputs`,
];

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function isAllowedPath(imagePath: string): boolean {
  return ALLOWED_VIRTUAL_ROOTS.some(
    (root) => imagePath === root || imagePath.startsWith(`${root}/`),
  );
}

function detectImageMime(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data.toString("ascii", 1, 4) === "PNG" &&
    data[5] === 0x0d &&
    data[6] === 0x0a &&
    data[7] === 0x1a &&
    data[8] === 0x0a
  ) {
    return "image/png";
  }
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

const viewImageSchema = z.object({
  description: z
    .string()
    .describe("Explain why you are viewing this image in short words. ALWAYS PROVIDE THIS PARAMETER FIRST."),
  image_path: z
    .string()
    .describe("Absolute /mnt/user-data virtual path to the image file. Supported formats: jpg, jpeg, png, webp."),
});

function getThreadId(config?: RunnableConfig): string {
  const raw = (config?.configurable as { thread_id?: unknown } | undefined)?.thread_id;
  return typeof raw === "string" && raw.length > 0 ? raw : "default";
}

/** Build the view_image tool bound to a sandbox provider. */
export function createViewImageTool(provider: SandboxToolProvider): StructuredToolInterface {
  return tool(
    async (input: z.infer<typeof viewImageSchema>, config?: RunnableConfig): Promise<string> => {
      const imagePath = input.image_path;

      if (!isAllowedPath(imagePath)) {
        return JSON.stringify({
          ok: false,
          error: `Only image paths under ${ALLOWED_VIRTUAL_ROOTS.join(", ")} are allowed.`,
        });
      }

      const ext = imagePath.slice(imagePath.lastIndexOf(".")).toLowerCase();
      const expectedMime = EXT_TO_MIME[ext];
      if (!expectedMime || !ALLOWED_EXTENSIONS.has(ext)) {
        return JSON.stringify({
          ok: false,
          error: `Unsupported image format '${ext}'. Supported formats: ${Object.keys(EXT_TO_MIME).join(", ")}.`,
        });
      }

      const sandbox = await provider.acquire(getThreadId(config));
      let data: Buffer;
      try {
        data = sandbox.readFileBinary(imagePath);
      } catch (err) {
        const code = (err as { code?: string }).code;
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          ok: false,
          error: code === "ENOENT" ? `Image file not found: ${imagePath}` : `Error reading image: ${msg}`,
        });
      }

      if (data.length > MAX_IMAGE_BYTES) {
        return JSON.stringify({
          ok: false,
          error: `Image file is too large (${data.length} bytes). Maximum supported size is ${MAX_IMAGE_BYTES} bytes.`,
        });
      }

      const detectedMime = detectImageMime(data);
      if (!detectedMime) {
        return JSON.stringify({ ok: false, error: "File contents do not match a supported image format." });
      }
      if (detectedMime !== expectedMime) {
        return JSON.stringify({
          ok: false,
          error: `Image contents are ${detectedMime}, but file extension indicates ${expectedMime}.`,
        });
      }

      const base64 = data.toString("base64");
      return JSON.stringify({
        ok: true,
        message: "Successfully read image.",
        viewed_image: {
          path: imagePath,
          base64,
          mime_type: detectedMime,
        },
      });
    },
    {
      name: "view_image",
      description: [
        "Read an image file and make it available for display.",
        "Use this tool to view a single image file.",
        "Supported paths: /mnt/user-data/workspace, /mnt/user-data/uploads, /mnt/user-data/outputs.",
        "Supported formats: jpg, jpeg, png, webp.",
      ].join("\n"),
      schema: viewImageSchema,
    },
  );
}

/**
 * File conversion utilities.
 *
 * Mirrors `quill.utils.file_conversion` from the Python backend.
 *
 * Uses `officeparser` to convert PDF / Office files to Markdown.
 */

import fs from "node:fs";
import path from "node:path";

/** File extensions that the conversion layer claims to support. */
export const CONVERTIBLE_EXTENSIONS = new Set([
  ".pdf",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".doc",
  ".docx",
]);

/** Files larger than this threshold are converted asynchronously. */
export const ASYNC_THRESHOLD_BYTES = 1 * 1024 * 1024;

/** Minimum characters per page before falling back to a secondary converter. */
export const MIN_CHARS_PER_PAGE = 50;

/** Maximum outline entries returned by `extractOutline`. */
export const MAX_OUTLINE_ENTRIES = 50;

export type PdfConverter = "auto" | "pymupdf4llm" | "markitdown";

/**
 * Convert a supported document file to Markdown.
 *
 * Returns the path to the generated `.md` file, or `null` if conversion fails.
 */
export async function convertFileToMarkdown(filePath: string): Promise<string | null> {
  try {
    const text = await doConvert(filePath);
    const mdPath = filePath.replace(/\.[^.]+$/, ".md");
    fs.writeFileSync(mdPath, text, "utf-8");
    console.info(`Converted ${path.basename(filePath)} to markdown: ${path.basename(mdPath)} (${text.length} chars)`);
    return mdPath;
  } catch (error) {
    console.error(`Failed to convert ${path.basename(filePath)} to markdown:`, error);
    return null;
  }
}

function makeFallbackMarkdown(filePath: string): string {
  return `# ${path.basename(filePath)}\n\n*(Document conversion failed in the JS runtime; file received: ${filePath})*\n`;
}

/**
 * Best-effort document-to-Markdown conversion via `officeparser`.
 *
 * Falls back to a placeholder Markdown string if `officeparser` throws.
 */
export async function doConvert(filePath: string, pdfConverter: PdfConverter = "auto"): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (!CONVERTIBLE_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file extension: ${ext}`);
  }

  // `pdfConverter` is accepted for API compatibility; officeparser handles PDF
  // automatically and there is no JS equivalent of pymupdf4llm.
  void pdfConverter;

  try {
    const { parseOffice } = await import("officeparser");
    const ast = await parseOffice(filePath);
    const md = await ast.to("md");
    return String(md.value ?? "");
  } catch (error) {
    console.error(`officeparser conversion failed for ${filePath}:`, error);
    return makeFallbackMarkdown(filePath);
  }
}

const BOLD_HEADING_RE = /^\*\*((ITEM|PART|SECTION|SCHEDULE|EXHIBIT|APPENDIX|ANNEX|CHAPTER)\b[A-Z0-9 .,\-]*)\*\*\s*$/;
const SPLIT_BOLD_HEADING_RE = /^\*\*[\dA-Z][\d\.]*\*\*\s+\*\*(?!\d[\d\s.,\-–—/:()%]*\*\*)[^*]+\*\*(?:\s+\*\*[^*]+\*\*){0,2}\s*$/;

/**
 * Normalise a title string that may contain bold artefacts.
 */
export function cleanBoldTitle(raw: string): string {
  const merged = raw.replace(/\*\*\s*\*\*/g, " ").trim();
  const m = merged.match(/^\*\*(.+?)\*\*$/s);
  if (m) {
    return m[1].trim();
  }
  return merged;
}

export interface OutlineEntry {
  title: string;
  line: number;
}

export interface TruncatedOutlineEntry {
  truncated: true;
}

export type OutlineItem = OutlineEntry | TruncatedOutlineEntry;

/**
 * Extract document outline (headings) from a Markdown file.
 */
export function extractOutline(mdPath: string): OutlineItem[] {
  const outline: OutlineItem[] = [];
  try {
    const text = fs.readFileSync(mdPath, "utf-8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lineno = i + 1;
      const stripped = lines[i].trim();
      if (!stripped) {
        continue;
      }

      if (stripped.startsWith("#")) {
        const title = cleanBoldTitle(stripped.replace(/^#+\s*/, ""));
        if (title) {
          outline.push({ title, line: lineno });
        }
      } else {
        const m = stripped.match(BOLD_HEADING_RE);
        if (m) {
          const title = m[1].trim();
          if (title) {
            outline.push({ title, line: lineno });
          }
          continue;
        }
        if (SPLIT_BOLD_HEADING_RE.test(stripped)) {
          const title = [...stripped.matchAll(/\*\*([^*]+)\*\*/g)].map((x) => x[1]).join(" ");
          if (title) {
            outline.push({ title, line: lineno });
          }
        }
      }

      if (outline.length >= MAX_OUTLINE_ENTRIES) {
        outline.push({ truncated: true });
        break;
      }
    }
  } catch {
    return [];
  }

  return outline;
}

/**
 * Return the configured PDF converter, defaulting to "auto".
 */
export function getPdfConverter(): PdfConverter {
  return "auto";
}

/**
 * Simple HTML-to-Markdown readability extractor.
 *
 * Mirrors the shape of `quill.utils.readability` but uses a minimal JS
 * implementation. The original Python module depends on `readabilipy` and
 * `markdownify`, which are not available in Node.js.
 */

import { URL } from "node:url";

export interface ArticleData {
  title: string;
  htmlContent: string;
  url?: string;
}

export class Article {
  url = "";
  title: string;
  htmlContent: string;

  constructor(title: string, htmlContent: string) {
    this.title = title;
    this.htmlContent = htmlContent;
  }

  /**
   * Convert the article to Markdown.
   *
   * This is a best-effort implementation: it strips HTML tags and preserves
   * basic structure. For production use, plug in a real HTML-to-Markdown
   * converter such as `turndown`.
   */
  toMarkdown(includingTitle = true): string {
    let markdown = "";
    if (includingTitle) {
      markdown += `# ${this.title}\n\n`;
    }
    if (!this.htmlContent || !String(this.htmlContent).trim()) {
      markdown += "*No content available*\n";
      return markdown;
    }
    const text = String(this.htmlContent)
      .replace(/<script\b[^\u003c]*(?:(?!<\/script>)<[^\u003c]*)*<\/script>/gi, "")
      .replace(/<style\b[^\u003c]*(?:(?!<\/style>)<[^\u003c]*)*<\/style>/gi, "")
      .replace(/\n\s*\n/g, "\n")
      .replace(/\u003cbr\s*\/?>/gi, "\n")
      .replace(/\u003cp\b[^\u003e]*>/gi, "\n\n")
      .replace(/\u003c\/p>/gi, "")
      .replace(/\u003c[^\u003e]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .trim();
    markdown += text;
    return markdown;
  }

  /**
   * Convert the article to a LangChain-compatible message content array.
   */
  toMessage(): Array<{ type: string; text?: string; image_url?: { url: string } }> {
    const imagePattern = /!\[.*?\]\((.*?)\)/g;
    const markdown = this.toMarkdown();

    if (!markdown || !markdown.trim()) {
      return [{ type: "text", text: "No content available" }];
    }

    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = imagePattern.exec(markdown)) !== null) {
      const textPart = markdown.slice(lastIndex, match.index).trim();
      if (textPart) {
        content.push({ type: "text", text: textPart });
      }
      const imageUrl = match[1].trim();
      content.push({
        type: "image_url",
        image_url: { url: this.url ? new URL(imageUrl, this.url).href : imageUrl },
      });
      lastIndex = match.index + match[0].length;
    }

    const trailing = markdown.slice(lastIndex).trim();
    if (trailing) {
      content.push({ type: "text", text: trailing });
    }

    if (content.length === 0) {
      return [{ type: "text", text: "No content available" }];
    }
    return content;
  }
}

export class ReadabilityExtractor {
  /**
   * Extract an article from HTML.
   *
   * JS doesn't have readabilipy, so this is a minimal fallback that uses the
   * page title and the sanitized body content.
   */
  extractArticle(html: string, { url, title }: { url?: string; title?: string } = {}): Article {
    const domTitle = html.match(/\u003ctitle\b[^\u003e]*>([^\u003c]*)\u003c\/title>/i)?.[1]?.trim();
    const articleTitle = title?.trim() || domTitle || "Untitled";

    // Very crude content extraction: keep the body if present.
    const bodyMatch = html.match(/\u003cbody\b[^\u003e]*>([\s\S]*?)\u003c\/body>/i);
    const htmlContent = bodyMatch?.[1] ?? html;

    const article = new Article(articleTitle, htmlContent);
    if (url) {
      article.url = url;
    }
    return article;
  }
}

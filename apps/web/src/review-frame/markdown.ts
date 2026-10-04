import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/common";
import {runMermaid} from "./mermaid-runtime.ts";
import markdownStyles from "./markdown.css?inline";

import type {ReviewAnchor} from "./protocol.ts";

interface MarkdownAsset {
  readonly path: string;
  readonly mediaType: string;
}

/** Derived review presentation only: the publication keeps its original bytes. */
export async function renderMarkdown(
  source: string,
  baseHref: string,
  versionBaseUrl: string,
  assets: readonly MarkdownAsset[],
): Promise<string> {
  const parser = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
    highlight: (code, language) => language !== "" && hljs.getLanguage(language)
      ? hljs.highlight(code, {language, ignoreIllegals: true}).value
      : "",
  });
  const escape = parser.utils.escapeHtml;
  const tokens = parser.parse(source, {});
  const headings: {id: string; title: string; level: number}[] = [];
  let section = "";
  for (const [index, token] of tokens.entries()) {
    if (token.type === "heading_open") {
      section = tokens[index + 1]?.content ?? "";
      const slug = section.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
      const id = `md-${token.map?.[0] ?? index}-${slug}`;
      token.attrSet("id", id);
      headings.push({id, title: section, level: Number(token.tag.slice(1))});
    }
    if (token.map !== null && (token.nesting === 1 || token.type === "fence" || token.type === "code_block")) {
      if (token.attrGet("id") === null) token.attrSet("id", `md-block-${index}`);
      token.attrSet("data-source-start", String(token.map[0] + 1));
      token.attrSet("data-source-end", String(token.map[1]));
      token.attrSet("data-source-section", section);
    }
    if (token.type === "inline" && tokens[index - 1]?.type === "paragraph_open" && tokens[index - 2]?.type === "list_item_open") {
      const first = token.children?.[0];
      const task = first?.type === "text" ? /^\[([ xX])\] /u.exec(first.content) : null;
      if (task !== null && first !== undefined) {
        tokens[index - 2]?.attrJoin("class", "md-task-item");
        first.content = first.content.slice(4);
        const checkbox = new MarkdownIt.Token("html_inline", "", 0);
        checkbox.content = `<input type="checkbox" disabled aria-label="Task"${task[1]?.toLowerCase() === "x" ? " checked" : ""}> `;
        token.children?.unshift(checkbox);
      }
    }
  }
  // Never let Markdown images request arbitrary remote or authenticated app URLs.
  parser.renderer.rules["image"] = (imageTokens, index) => {
    const token = imageTokens[index];
    if (token === undefined) return "";
    const authored = String(token.attrGet("src") ?? "");
    const alt = token.content;
    try {
      const url = new URL(authored, baseHref);
      const allowed = assets.some((asset) =>
        asset.mediaType.toLowerCase().startsWith("image/") &&
        url.href === new URL(asset.path.split("/").map(encodeURIComponent).join("/"), versionBaseUrl).href
      );
      if (allowed) {
        const caption = String(token.attrGet("title") ?? "");
        return `<span class="md-image"><img src="${escape(url.href)}" alt="${escape(alt)}" loading="lazy" referrerpolicy="no-referrer">${caption === "" ? "" : `<span class="md-image-caption">${escape(caption)}</span>`}</span>`;
      }
    } catch {
      // Invalid URLs remain readable as image labels, without a network request.
    }
    return `<span class="md-image-unavailable">[Image unavailable: ${escape(alt)}]</span>`;
  };
  parser.renderer.rules["link_open"] = (linkTokens, index, options, _env, renderer) => {
    const token = linkTokens[index];
    const href = String(token?.attrGet("href") ?? "");
    if (href.startsWith("#")) {
      const target = headings.find((heading) => heading.id === href.slice(1) || heading.id.replace(/^md-\d+-/u, "") === href.slice(1));
      if (target !== undefined) token?.attrSet("href", `#${target.id}`);
    } else {
      try {
        const url = new URL(href, baseHref);
        if (!["https:", "http:", "mailto:"].includes(url.protocol)) token?.attrSet("href", "#");
        else token?.attrSet("href", url.href);
      } catch {
        token?.attrSet("href", "#");
      }
      token?.attrSet("target", "_blank");
      token?.attrSet("rel", "noopener noreferrer");
      token?.attrSet("referrerpolicy", "no-referrer");
    }
    return renderer.renderToken(linkTokens, index, options);
  };
  // markdown-it's fenced-code renderer omits token attributes. Preserve its
  // parser-derived source range on a wrapper without changing the code bytes.
  for (const rule of ["fence", "code_block"] as const) {
    const renderCode = parser.renderer.rules[rule];
    if (renderCode === undefined) continue;
    parser.renderer.rules[rule] = (codeTokens, index, options, env, renderer) => {
      const token = codeTokens[index];
      const mermaid = rule === "fence" && token?.info.trim() === "mermaid";
      const tag = mermaid ? "figure" : "div";
      return `<${tag}${token === undefined ? "" : renderer.renderAttrs(token)}${mermaid ? ' class="md-mermaid"' : ""}>${renderCode(codeTokens, index, options, env, renderer)}</${tag}>`;
    };
  }
  parser.renderer.rules["table_open"] = (tableTokens, index, options, _env, renderer) => `<div class="md-table-wrap">${renderer.renderToken(tableTokens, index, options)}`;
  parser.renderer.rules["table_close"] = (tableTokens, index, options, _env, renderer) => `${renderer.renderToken(tableTokens, index, options)}</div>`;
  const hasMermaid = tokens.some((token) => token.type === "fence" && token.info.trim() === "mermaid");
  // Trusted, self-contained runtime executes only in the viewer's opaque sandbox.
  const mermaidBundle = hasMermaid ? (await import("@mermaid-js/tiny/dist/mermaid.tiny.js?raw")).default : "";
  const diagramScript = hasMermaid ? `<script>${mermaidBundle.replace(/<\/script/giu, "<\\/script")}\n(${runMermaid.toString()})();</script>` : "";
  const navigation = headings.length < 2 ? "" : `<nav class="md-outline" aria-label="Document sections"><details><summary>Contents</summary><ol>${headings.map((heading) => `<li class="md-toc-level-${heading.level}"><a href="#${heading.id}">${escape(heading.title)}</a></li>`).join("")}</ol></details></nav>`;
  return `<!doctype html><html lang="en"><head><base href="about:srcdoc"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="plannotator-theme" content="host"><title>Markdown review</title><style>${markdownStyles}</style></head><body><div class="md-layout">${navigation}<main class="md-document">${parser.renderer.render(tokens, parser.options, {})}</main></div>${diagramScript}</body></html>`;
}

/** Block ranges are exact; rendered selections can omit Markdown punctuation. */
export function withMarkdownSource(anchor: ReviewAnchor | null, html: string, source: string): ReviewAnchor | null {
  if (anchor === null || anchor.htmlAnchor === null) return anchor;
  const document = new DOMParser().parseFromString(html, "text/html");
  let block: Element | null;
  try {
    block = document.querySelector(anchor.htmlAnchor.selector)?.closest("[data-source-start]") ?? null;
  } catch {
    return anchor;
  }
  if (block === null) return anchor;
  const startLine = Number(block.getAttribute("data-source-start"));
  const endLine = Number(block.getAttribute("data-source-end"));
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) return anchor;
  const lines = source.split(/\r\n|\r|\n/u);
  const sourceText = lines.slice(startLine - 1, endLine).join("\n");
  return {
    ...anchor,
    markdownSource: {
      startLine,
      endLine,
      section: (block.getAttribute("data-source-section") ?? "").slice(0, 512),
      sourceText: sourceText.slice(0, 2_000),
      truncated: sourceText.length > 2_000,
    },
  };
}

import type * as Pele from "pele";

declare global {
  interface Window { pele: typeof Pele; }
}

/** Serialized into derived Markdown only; never invoked in the authenticated app. */
export function runMermaid(): void {
  const pele = window.pele;
  // These helpers must remain self-contained when this function is serialized.
  const blocks = Array.from(document.querySelectorAll<HTMLElement>(".md-mermaid"));
  const sources = blocks.map((block) => block.querySelector("code")?.textContent ?? "");
  const fontFamily = getComputedStyle(document.body).fontFamily;
  const draw = (block: HTMLElement, index: number, width: number): void => {
    const source = sources[index] ?? "";
    const unavailable = (reason: string, snippet = ""): void => {
      // Pele's messages can quote diagram text, so every part stays text.
      const message = document.createElement("p");
      message.className = "md-diagram-status";
      message.textContent = `Diagram unavailable: ${reason} Its Mermaid source is shown below.`;
      const parts: HTMLElement[] = [message];
      if (snippet !== "") {
        const pre = document.createElement("pre");
        pre.className = "md-diagram-error";
        pre.textContent = snippet;
        parts.push(pre);
      }
      const pre = document.createElement("pre");
      pre.className = "md-diagram-source";
      const code = document.createElement("code");
      code.textContent = source;
      pre.append(code);
      parts.push(pre);
      block.replaceChildren(...parts);
      block.dataset["diagramState"] = "unavailable";
    };
    // Authors never supply Pele options or Mermaid config: front matter and
    // %%{init}%% directives would override the review's fixed settings. Pele
    // opens front matter at "---" followed by any whitespace run that holds a
    // line break, so refuse "---" followed by any whitespace at all.
    if (/^\s*---\s/u.test(source) || source.includes("%%{")) {
      unavailable("diagram settings (front matter or %%{init}%% directives) aren't applied in review.");
      return;
    }
    let result: Pele.RenderResult;
    try {
      result = pele.render(source, {
        idPrefix: `md-diagram-${index}-`, fontFamily, fontSize: 14, maxWidth: width,
        limit: 20_000, linkRel: "noopener noreferrer",
      });
    } catch (error) {
      if (!(error instanceof pele.PeleError)) {
        unavailable("the diagram couldn't be drawn.");
        return;
      }
      const position = error.line > 0 ? ` on line ${error.line}${error.column > 0 ? `, column ${error.column}` : ""}` : "";
      const reason = error.code === "syntax" ? `syntax error${position}.`
        : error.code === "unsupported-diagram" ? "this diagram type isn't supported."
        : error.code === "limit" ? "the diagram is too large to draw."
        : error.message;
      unavailable(reason, error.snippet);
      return;
    }
    // The frame may load remote images, so a diagram that would fetch one keeps
    // its source instead, as Markdown images do.
    if (result.svg.includes("<image")) {
      unavailable("diagrams that load images aren't drawn in review.");
      return;
    }
    const template = document.createElement("template");
    template.innerHTML = result.svg;
    const diagram = template.content.firstElementChild;
    if (diagram === null) {
      unavailable("the diagram couldn't be drawn.");
      return;
    }
    // Diagram links open like Markdown links: a new tab, no referrer.
    for (const link of diagram.querySelectorAll("a")) {
      link.setAttribute("target", "_blank");
      link.setAttribute("referrerpolicy", "no-referrer");
    }
    if (!diagram.hasAttribute("aria-labelledby")) diagram.setAttribute("aria-label", "Mermaid diagram");
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Diagram source";
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = source;
    pre.append(code);
    details.append(summary, pre);
    block.replaceChildren(diagram, details);
    block.dataset["diagramState"] = "rendered";
  };
  // Colours follow the theme through CSS variables; only a width change needs a
  // new layout (Pele may wrap labels or turn a wide flowchart vertical).
  blocks.forEach((block, index) => {
    let drawnWidth = -1;
    const redraw = (): void => {
      const width = Math.round(block.clientWidth) || 740;
      if (width === drawnWidth) return;
      drawnWidth = width;
      draw(block, index, width);
    };
    redraw();
    new ResizeObserver(redraw).observe(block);
  });
}

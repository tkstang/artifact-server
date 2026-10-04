interface MermaidParserContext {
  readonly lex?: {firstGraph(): boolean};
}

interface MermaidParser {
  readonly parser?: MermaidParser;
  readonly symbols_?: Readonly<Record<string, number>>;
  readonly lexer?: {setInput(source: string, context: MermaidParserContext): void; lex(): string | number};
}

interface MermaidRuntime {
  readonly mermaidAPI: {
    getDiagramFromText(source: string): Promise<{type: string; text: string; parser: MermaidParser; db: MermaidParserContext}>;
  };
  initialize(config: {
    startOnLoad: boolean; securityLevel: "strict"; htmlLabels: boolean;
    theme: "base"; fontFamily: string; maxTextSize: number; maxEdges: number;
    flowchart: {htmlLabels: boolean; useMaxWidth: boolean};
    themeVariables: {darkMode: boolean; background: string; primaryColor: string; primaryTextColor: string; primaryBorderColor: string; lineColor: string; secondaryColor: string; tertiaryColor: string; fontSize: string; edgeLabelBackground: string; nodeShadow: boolean; dropShadow: string};
  }): void;
  render(id: string, source: string, container: Element): Promise<{svg: string}>;
}

declare global {
  interface Window { mermaid: MermaidRuntime; }
}

/** Serialized into derived Markdown only; never invoked in the authenticated app. */
export function runMermaid(): void {
  const mermaid = window.mermaid;
  // These helpers must remain self-contained when this function is serialized.
  const cssUrlPattern = /url\s*\(([^)]*)\)/giu;
  const hasExternalCssResource = (value: string): boolean => /@import/iu.test(value) ||
    Array.from(value.matchAll(cssUrlPattern)).some((match) => !(match[1] ?? "").trim().replace(/^["']|["']$/gu, "").startsWith("#"));
  const forbiddenStatement = /(?:^|[;\r\n])\s*(?:click|style|classDef|linkStyle)(?=\s|$)/iu;
  const hasForbiddenStatement = (source: string): boolean => {
    // Mermaid statements may begin after semicolons as well as newlines. Mask
    // quoted label text and line comments before checking those boundaries.
    // Do not mask brace bodies: nested diagrams can contain real directives.
    // Match pinned Mermaid preprocessing: only entire %% comment lines are
    // removed. Percent signs inside an unquoted node label are ordinary text.
    const code = source.replace(/\r\n?/gu, "\n").replace(/^\s*%%(?!\{)[^\n]+\n?/gmu, "");
    let quoted = false;
    let statements = "";
    for (let index = 0; index < code.length; index += 1) {
      const character = code[index] ?? "";
      if (quoted) {
        // Pinned Mermaid's string lexer ends at the next double quote: a
        // backslash is ordinary text, and a bare backtick is not a delimiter.
        if (character === '"') quoted = false;
        statements += " ";
        continue;
      }
      if (character === '"') {
        quoted = true;
        statements += " ";
      } else statements += character;
    }
    return forbiddenStatement.test(statements);
  };
  const blocks = Array.from(document.querySelectorAll<HTMLElement>(".md-mermaid"));
  const sources = blocks.map((block) => block.querySelector("code")?.textContent ?? "");
  let generation = 0;
  let pending = Promise.resolve();
  const render = (): void => {
    const current = ++generation;
    pending = pending.then(async () => {
      if (current !== generation) return undefined;
      const light = document.documentElement.classList.contains("light");
      mermaid.initialize({
        startOnLoad: false, securityLevel: "strict", htmlLabels: false,
        theme: "base", fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        maxTextSize: 20_000, maxEdges: 200,
        flowchart: {htmlLabels: false, useMaxWidth: true},
        themeVariables: {
          darkMode: !light, background: light ? "#fbfaf7" : "#202124",
          primaryColor: light ? "#f2f0ea" : "#2e3239",
          primaryTextColor: light ? "#37352f" : "#e1dfda",
          primaryBorderColor: light ? "#c8c4ba" : "#666c75",
          lineColor: light ? "#75736d" : "#a7adb6",
          secondaryColor: light ? "#e9eef2" : "#303b48",
          tertiaryColor: light ? "#f2f0ea" : "#303238",
          fontSize: "14px", nodeShadow: false, dropShadow: "none", edgeLabelBackground: light ? "#fbfaf7" : "#202124",
        },
      });
      await blocks.reduce(async (previous, block, index) => {
        await previous;
        const source = sources[index] ?? "";
        const fallback = (): void => {
          block.replaceChildren();
          const message = document.createElement("p");
          message.className = "md-diagram-status";
          message.textContent = "Diagram unavailable. Its original Mermaid source is shown below.";
          const pre = document.createElement("pre");
          const code = document.createElement("code");
          code.textContent = source;
          pre.append(code);
          block.append(message, pre);
          block.dataset["diagramState"] = "unavailable";
        };
        // Configuration, embedded HTML, CSS resource loads and click directives
        // are deliberately outside this static review diagram contract.
        if (source.length > 20_000 || /%%\{|^---\s*$|\b(?:img|icon)\s*:|(?:https?|data|javascript|file):|<\s*(?:\/?[a-z]|!)|url\s*\(|@import/imu.test(source)) {
          fallback();
          return;
        }
        const scratch = document.createElement("div");
        scratch.className = "md-diagram-scratch";
        document.body.append(scratch);
        try {
          // A bounded source scan is not a complete Mermaid grammar. Use the
          // pinned parser's tokens as a backstop for special lexical modes,
          // such as quotes inside accessibility descriptions or direction.
          const parsedDiagram = await mermaid.mermaidAPI.getDiagramFromText(source);
          const parser = parsedDiagram.parser.parser ?? parsedDiagram.parser;
          const symbols = parser["symbols_"];
          if (parser.lexer !== undefined && symbols !== undefined) {
            const rejectedTokens = new Set<string | number>(["STYLE", "CLASSDEF", "CLICK", "LINKSTYLE"]);
            for (const [name, token] of Object.entries(symbols)) {
              if (/^(?:style|classdef|click|linkstyle)$/iu.test(name)) rejectedTokens.add(token);
            }
            parser.lexer.setInput(parsedDiagram.text, parsedDiagram.db);
            let complete = false;
            // Every token consumes input or reaches EOF; cap a broken lexer
            // rather than allowing an upstream change to hang this viewer.
            for (let scanned = 0; scanned <= parsedDiagram.text.length * 2 + 1; scanned += 1) {
              const token = parser.lexer.lex();
              if (rejectedTokens.has(token)) {
                fallback();
                return;
              }
              if (token === "EOF" || token === symbols["EOF"] || token === 1) {
                complete = true;
                break;
              }
            }
            if (!complete) throw new Error("Diagram policy lexer did not complete");
          } else if (parsedDiagram.type.startsWith("flowchart")) {
            throw new Error("Pinned flowchart policy lexer unavailable");
          } else if (hasForbiddenStatement(source)) {
            // Diagrams without a Jison lexer retain conservative screening.
            fallback();
            return;
          }
          const {svg} = await mermaid.render(`md-diagram-${current}-${index}`, source, scratch);
          const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
          const diagram = parsed.documentElement;
          if (diagram.localName !== "svg" || parsed.querySelector("parsererror") !== null) throw new Error("Invalid SVG");
          for (const element of diagram.querySelectorAll("script, foreignObject, image, a, iframe, object, embed, animate, animateMotion, animateTransform, set")) element.remove();
          for (const element of [diagram, ...diagram.querySelectorAll("*")]) {
            for (const attribute of Array.from(element.attributes)) {
              if (/^on/iu.test(attribute.name) || hasExternalCssResource(attribute.value) || /(?:href|src)$/iu.test(attribute.name) && !attribute.value.startsWith("#")) element.removeAttribute(attribute.name);
            }
            if (element.localName === "style" && hasExternalCssResource(element.textContent ?? "")) element.remove();
          }
          // Keep CSS out of the figure's text quote and preserve legible labels
          // on wide diagrams; the figure provides local horizontal scrolling.
          document.getElementById(`md-diagram-style-${index}`)?.remove();
          const style = document.createElement("style");
          style.id = `md-diagram-style-${index}`;
          style.textContent = Array.from(diagram.querySelectorAll("style"), (element) => element.textContent ?? "").join("\n");
          for (const element of diagram.querySelectorAll("style")) element.remove();
          document.head.append(style);
          const width = Number(diagram.getAttribute("viewBox")?.split(/\s+/u)[2]);
          if (Number.isFinite(width) && width > 0) diagram.style.minWidth = `${Math.min(width, 960)}px`;
          diagram.setAttribute("role", "img");
          diagram.setAttribute("aria-label", "Mermaid diagram");
          const details = document.createElement("details");
          const summary = document.createElement("summary");
          summary.textContent = "Diagram source";
          const pre = document.createElement("pre");
          const code = document.createElement("code");
          code.textContent = source;
          pre.append(code);
          details.append(summary, pre);
          block.replaceChildren(document.importNode(diagram, true), details);
          block.dataset["diagramState"] = "rendered";
        } catch {
          fallback();
        } finally {
          scratch.remove();
        }
      }, Promise.resolve());
      return undefined;
    });
  };
  new MutationObserver(render).observe(document.documentElement, {attributes: true, attributeFilter: ["class"]});
  render();
}

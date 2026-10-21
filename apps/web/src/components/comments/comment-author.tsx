import type {CSSProperties} from "react";

/**
 * Avatar fills, each dark enough to carry white initials at 4.9:1 or better,
 * so one list serves both review themes.
 */
const avatarFills = [
  "#b4532a",
  "#2f7d6b",
  "#0369a1",
  "#7e22ce",
  "#be185d",
  "#4d7c0f",
  "#a16207",
  "#1d4ed8",
] as const;

/** The same name always gets the same fill, on every card and every visit. */
function avatarFill(displayName: string): string {
  let hash = 0;
  for (const character of displayName) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return avatarFills[hash % avatarFills.length] ?? avatarFills[0];
}

const graphemes = new Intl.Segmenter(undefined, {granularity: "grapheme"});

/** First and last word's first character, whole even for emoji and accents. */
function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter((word) => word !== "");
  const picked = words.length <= 1 ? words : [words[0], words.at(-1)];
  return picked
    .map((word) => graphemes.segment(word ?? "")[Symbol.iterator]().next().value?.segment ?? "")
    .join("")
    .toLocaleUpperCase() || "?";
}

/**
 * Who wrote a comment or reply: initials avatar, name, and an "Agent" tag for
 * a registered agent. The name is the accessible text; the avatar is decoration.
 */
export function CommentAuthor({
  displayName,
  isAgent,
}: {
  readonly displayName: string;
  readonly isAgent: boolean;
}) {
  const style: CSSProperties = {background: avatarFill(displayName)};
  return (
    <span className="as-comment-author">
      <span aria-hidden className="as-comment-author__avatar" style={style}>
        {initials(displayName)}
      </span>
      <strong>{displayName}</strong>
      {isAgent ? <span className="as-comment-author__agent">Agent</span> : null}
    </span>
  );
}

/**
 * A small, strict well-formedness checker for the SVG strings the heraldry
 * module emits (no DOM in the Node test environment): balanced tags, quoted
 * attributes, no duplicate ids, every url(#id) / href="#id" resolvable, and no
 * NaN / undefined / Infinity leaking into the markup.
 */
export interface SvgReport {
  errors: string[];
  ids: string[];
}

export function checkSvg(svg: string): SvgReport {
  const errors: string[] = [];
  const ids: string[] = [];
  if (!svg.startsWith("<svg")) errors.push("does not start with <svg");
  if (!svg.endsWith("</svg>")) errors.push("does not end with </svg>");
  for (const bad of ["NaN", "undefined", "Infinity", "null", "[object"]) {
    if (svg.includes(bad)) errors.push(`contains ${bad}: …${svg.slice(Math.max(0, svg.indexOf(bad) - 60), svg.indexOf(bad) + 20)}…`);
  }
  const stack: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(svg))) {
    const between = svg.slice(last, m.index);
    if (between.includes("<")) errors.push(`malformed tag near …${svg.slice(last, last + 80)}…`);
    last = tagRe.lastIndex;
    const [, close, name, attrs, self] = m;
    if (close) {
      const top = stack.pop();
      if (top !== name) errors.push(`mismatched </${name}> (open: ${top})`);
    } else {
      const idm = /\sid="([^"]*)"/.exec(attrs);
      if (idm) ids.push(idm[1]);
      if (!self) stack.push(name);
    }
  }
  if (svg.slice(last).includes("<")) errors.push("trailing malformed markup");
  if (stack.length) errors.push(`unclosed: ${stack.join(",")}`);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`duplicate id ${id}`);
    seen.add(id);
  }
  const refRe = /url\(#([^)]+)\)|href="#([^"]+)"/g;
  while ((m = refRe.exec(svg))) {
    const id = m[1] ?? m[2];
    if (!seen.has(id)) errors.push(`dangling reference #${id}`);
  }
  return { errors, ids };
}

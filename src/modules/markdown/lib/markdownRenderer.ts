import { Marked, Renderer } from "marked";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const renderer = new Renderer();

renderer.html = ({ text }) => escapeHtml(text);

const parser = new Marked({
  async: false,
  gfm: true,
  breaks: false,
  renderer,
});

export function renderMarkdownToHtml(markdown: string): string {
  return parser.parse(markdown, { async: false }) as string;
}

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  table: ({ children }) => (
    <div className="markdown-table">
      <table>{children}</table>
    </div>
  ),
};

/**
 * Renders trusted Markdown as safe HTML with GFM tables and images removed.
 *
 * @param props - Component props.
 * @param props.children - Markdown source to render.
 * @returns The rendered Markdown element.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={["img"]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

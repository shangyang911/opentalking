import type { Message } from "../../../shared/types";

interface ChatBubbleProps {
  message: Message;
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex animate-slide-up ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[86%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-cyan-600 text-white"
            : "bg-slate-100 text-slate-800"
        }`}
      >
        {message.text}
        {!isUser && !!message.sources?.length && <details className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500">
          <summary className="cursor-pointer">检索参考资料 · {message.sources.length}</summary>
          <ul className="mt-1 space-y-1">{message.sources.map((source, index) => <li key={`${source.doc_id}-${index}`}>{source.filename}</li>)}</ul>
        </details>}
      </div>
    </div>
  );
}

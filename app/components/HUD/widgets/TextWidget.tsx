'use client';

export function TextWidget({ content }: { content: string }) {
  return (
    <div className="h-full min-h-0 flex flex-col px-1 pb-1">
      <pre className="flex-1 min-h-0 overflow-auto text-sm leading-relaxed text-white/90 font-mono whitespace-pre-wrap break-words [scrollbar-width:thin] [scrollbar-color:rgba(34,211,238,0.35)_transparent]">
        {content || (
          <span className="text-cyan-400/40 italic">Empty note</span>
        )}
      </pre>
    </div>
  );
}

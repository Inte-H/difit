import { MessageSquare } from 'lucide-react';

interface CommentCountProps {
  count: number;
  title?: string;
}

export function CommentCount({ count, title }: CommentCountProps) {
  return (
    <span
      title={title}
      className="shrink-0 text-github-warning fixup-review:text-github-text-secondary text-sm font-medium ml-auto flex items-center gap-1"
    >
      <MessageSquare size={14} />
      {count}
    </span>
  );
}

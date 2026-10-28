interface FilePathTextProps {
  path: string;
  className?: string;
}

// The ltr bdi keeps `/` and brackets in order inside the rtl box.
export function FilePathText({ path, className = '' }: FilePathTextProps) {
  return (
    <span
      className={`block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-left [direction:rtl] ${className}`}
      title={path}
    >
      <bdi dir="ltr">{path}</bdi>
    </span>
  );
}

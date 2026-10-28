interface FilePathTextProps {
  path: string;
  className?: string;
}

// The rtl box cuts the path from the front, so the file name at the end stays visible; the ltr bdi
// keeps `/` and brackets in order.
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

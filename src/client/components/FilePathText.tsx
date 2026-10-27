interface FilePathTextProps {
  path: string;
  className?: string;
}

// The ltr bdi keeps `/` and brackets in order inside the rtl box.
export function FilePathText({ path, className = '' }: FilePathTextProps) {
  const nameStart = path.lastIndexOf('/') + 1;
  const directory = path.slice(0, nameStart);
  const name = path.slice(nameStart);

  return (
    <span className={`relative flex min-w-0 ${className}`} title={path}>
      <span className="sr-only">{path}</span>
      {directory && (
        <span
          aria-hidden="true"
          className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [direction:rtl]"
        >
          <bdi dir="ltr">{directory}</bdi>
        </span>
      )}
      <span
        aria-hidden="true"
        className="shrink-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
      >
        {name}
      </span>
    </span>
  );
}

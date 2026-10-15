import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import type { ChangeKindsResponse, DiffFile, DiffResponse } from '../../types/diff';

interface UseChunkChangeKindsParams {
  diffData: DiffResponse | null;
  renderedFilePaths: Set<string>;
  setDiffData: Dispatch<SetStateAction<DiffResponse | null>>;
}

const sameDiff = (a: DiffResponse, b: DiffResponse) =>
  a.requestedBaseCommitish === b.requestedBaseCommitish &&
  a.requestedTargetCommitish === b.requestedTargetCommitish &&
  a.requestedBaseMode === b.requestedBaseMode &&
  a.ignoreWhitespace === b.ignoreWhitespace;

export function useChunkChangeKinds({
  diffData,
  renderedFilePaths,
  setDiffData,
}: UseChunkChangeKindsParams) {
  const requestedRef = useRef(new WeakSet<DiffFile>());

  useEffect(() => {
    if (!diffData || diffData.targetCommitish === 'stdin') return;

    const params = new URLSearchParams({ ignoreWhitespace: String(diffData.ignoreWhitespace) });
    if (diffData.requestedBaseCommitish) params.set('base', diffData.requestedBaseCommitish);
    if (diffData.requestedTargetCommitish) params.set('target', diffData.requestedTargetCommitish);
    if (diffData.requestedBaseMode === 'merge-base') params.set('baseMode', 'merge-base');

    for (const file of diffData.files) {
      if (
        !renderedFilePaths.has(file.path) ||
        (file.status !== 'modified' && file.status !== 'renamed') ||
        file.chunks.length === 0 ||
        file.chunks.some((chunk) => chunk.changeKind)
      ) {
        continue;
      }
      if (requestedRef.current.has(file)) continue;
      requestedRef.current.add(file);

      fetch(`/api/change-kinds/${encodeURIComponent(file.path)}?${params}`)
        .then((res) => (res.ok ? (res.json() as Promise<ChangeKindsResponse>) : null))
        .then((payload) => {
          if (!payload) return;
          setDiffData((prev) => {
            if (!prev || !sameDiff(prev, diffData)) return prev;
            let changed = false;
            const files = prev.files.map((candidate) => {
              const matches =
                candidate.path === payload.path &&
                candidate.chunks.length === payload.chunks.length &&
                candidate.chunks.every(
                  (chunk, index) => chunk.header === payload.chunks[index]?.header,
                ) &&
                payload.chunks.some((chunk) => chunk.changeKind);
              if (!matches) return candidate;
              changed = true;
              return {
                ...candidate,
                chunks: candidate.chunks.map((chunk, index) => {
                  const changeKind = payload.chunks[index]?.changeKind;
                  return changeKind ? { ...chunk, changeKind } : chunk;
                }),
              };
            });
            return changed ? { ...prev, files } : prev;
          });
        })
        .catch(() => undefined);
    }
  }, [diffData, renderedFilePaths, setDiffData]);
}

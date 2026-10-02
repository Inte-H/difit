import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DirectEditControls } from '../contexts/FixupOverlayContext';

import { DirectEditForm } from './DirectEditForm';

function controls(overrides: Partial<DirectEditControls> = {}): DirectEditControls {
  return {
    submit: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const serveBlob = (bytes: Uint8Array) =>
  vi.mocked(global.fetch).mockResolvedValue({
    ok: true,
    arrayBuffer: async () => bytes.slice().buffer,
  } as Response);

const renderForm = (edit: DirectEditControls, onClose = vi.fn(), threadId?: string) =>
  render(
    <DirectEditForm
      filePath="src/a.ts"
      range={{ start: 3, end: 4 }}
      targetCommit="abc1234"
      threadId={threadId}
      controls={edit}
      onClose={onClose}
    />,
  );

const editor = () => screen.findByLabelText('고칠 코드');

describe('DirectEditForm', () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockReset();
    serveBlob(new TextEncoder().encode('a\nb\n// one\nconst x = 1;\nz\n'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts from the lines of the reviewed commit', async () => {
    renderForm(controls());

    expect(screen.getByText('리뷰 대상 커밋의 코드를 읽는 중…')).toBeInTheDocument();
    expect(await editor()).toHaveValue('// one\nconst x = 1;');
    expect(global.fetch).toHaveBeenCalledWith('/api/blob/src%2Fa.ts?ref=abc1234');
  });

  it('drops the lines it loaded when the reviewed commit changes', async () => {
    const edit = controls();
    const { rerender } = renderForm(edit);
    await editor();
    vi.mocked(global.fetch).mockReturnValue(new Promise<Response>(() => {}));

    rerender(
      <DirectEditForm
        filePath="src/a.ts"
        range={{ start: 3, end: 4 }}
        targetCommit="def5678"
        controls={edit}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('리뷰 대상 커밋의 코드를 읽는 중…')).toBeInTheDocument();
    expect(screen.queryByLabelText('고칠 코드')).not.toBeInTheDocument();
  });

  it('starts from CRLF lines without their CR and keeps a BOM on line one', async () => {
    serveBlob(
      new Uint8Array([
        0xef,
        0xbb,
        0xbf,
        ...new TextEncoder().encode('a\r\nb\r\n// one\r\nconst x = 1;\r\n'),
      ]),
    );
    const edit = controls();
    render(
      <DirectEditForm
        filePath="src/a.ts"
        range={{ start: 1, end: 3 }}
        targetCommit="abc1234"
        controls={edit}
        onClose={vi.fn()}
      />,
    );

    expect(await editor()).toHaveValue('﻿a\nb\n// one');
    fireEvent.change(await editor(), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(edit.submit).toHaveBeenCalledWith(
        expect.objectContaining({ original: ['﻿a', 'b', '// one'], replacement: ['a'] }),
      ),
    );
  });

  it('says so when the lines cannot be read', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false } as Response);
    renderForm(controls());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '리뷰 대상 커밋에서 이 줄들을 읽지 못했습니다.',
    );
    expect(screen.queryByLabelText('고칠 코드')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '줄 지우기' })).toBeDisabled();
  });

  it('sends the edited lines and closes once the fixup is committed', async () => {
    const edit = controls();
    const onClose = vi.fn();
    renderForm(edit, onClose, 'c1');

    fireEvent.change(await editor(), { target: { value: 'const x = 1;' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(edit.submit).toHaveBeenCalledWith({
      filePath: 'src/a.ts',
      startLine: 3,
      endLine: 4,
      original: ['// one', 'const x = 1;'],
      replacement: ['const x = 1;'],
      threadId: 'c1',
    });
  });

  it('sends one empty line when the text is cleared', async () => {
    const edit = controls();
    renderForm(edit);

    fireEvent.change(await editor(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(edit.submit).toHaveBeenCalledWith(expect.objectContaining({ replacement: [''] })),
    );
  });

  it('sends no lines from the delete button', async () => {
    const edit = controls();
    renderForm(edit);

    await editor();
    fireEvent.click(screen.getByRole('button', { name: '줄 지우기' }));

    await waitFor(() => expect(edit.submit).toHaveBeenCalled());
    const request = vi.mocked(edit.submit).mock.calls[0]?.[0];
    expect(request).toMatchObject({ original: ['// one', 'const x = 1;'], replacement: [] });
    expect(request).not.toHaveProperty('threadId');
    expect(request).not.toHaveProperty('skipHooks');
  });

  it('keeps the form open and shows why when the server refuses', async () => {
    const edit = controls({
      submit: vi.fn().mockResolvedValue({ message: '커밋 실패', output: 'git says no' }),
    });
    const onClose = vi.fn();
    renderForm(edit, onClose);

    fireEvent.change(await editor(), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('커밋 실패');
    expect(screen.getByRole('alert')).toHaveTextContent('git says no');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cannot commit before anything changes', async () => {
    renderForm(controls());
    await editor();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });

  it('says both buttons commit at once without running commit hooks', () => {
    renderForm(controls());
    expect(
      screen.getByText(
        '저장이나 줄 지우기를 누르면 바로 리뷰 대상 커밋을 고치는 fixup 커밋이 만들어집니다. 커밋 훅은 실행하지 않습니다.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('puts the delete button after cancel and save in focus order', async () => {
    renderForm(controls());
    await editor();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '취소',
      '저장',
      '줄 지우기',
    ]);
  });

  it('asks before throwing away an edit to delete the lines', async () => {
    const edit = controls();
    renderForm(edit);
    fireEvent.change(await editor(), { target: { value: 'x' } });
    const confirmSpy = vi.fn().mockReturnValueOnce(false);
    vi.stubGlobal('confirm', confirmSpy);

    fireEvent.click(screen.getByRole('button', { name: '줄 지우기' }));
    expect(confirmSpy).toHaveBeenCalledWith('고친 내용을 버리고 고른 줄을 지울까요?');
    expect(edit.submit).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: '줄 지우기' }));
    await waitFor(() =>
      expect(edit.submit).toHaveBeenCalledWith(expect.objectContaining({ replacement: [] })),
    );
  });

  it('shows progress on the button that was pressed', async () => {
    const edit = controls({ submit: vi.fn(() => new Promise<null>(() => {})) });
    renderForm(edit);
    fireEvent.change(await editor(), { target: { value: 'x' } });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );

    fireEvent.click(screen.getByRole('button', { name: '줄 지우기' }));

    expect(await screen.findByRole('button', { name: '지우는 중…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
  });
});

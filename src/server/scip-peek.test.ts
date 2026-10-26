import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POSITION_ENCODING, type ScipIndex, convertScipIndex } from './scip-index';
import { type CommitFiles, answerFromScipIndex, commitFiles } from './scip-peek';

// The index.scip fixture and its Java sources; scip-index.test.ts says how it was made.
const FIXTURE_DIR = join(__dirname, 'scip-index-fixture');
const SERVICE = 'src/main/java/demo/Service.java';
const PORT = 'src/main/java/demo/Port.java';
const CACHE = 'src/main/java/demo/Cache.java';

function fixtureLines(path: string): string[] {
  return readFileSync(join(FIXTURE_DIR, path), 'utf8').split('\n');
}

function fixtureCommit(...left: string[]): CommitFiles {
  return {
    existing: async (paths) => new Set(paths.filter((path) => !left.includes(path))),
    readLines: async (paths) =>
      new Map(
        paths.filter((path) => !left.includes(path)).map((path) => [path, fixtureLines(path)]),
      ),
  };
}

function columnOf(path: string, line: number, name: string, nth = 0): number {
  const text = fixtureLines(path)[line - 1] ?? '';
  let column = -1;
  for (let i = 0; i <= nth; i++) column = text.indexOf(name, column + 1);
  if (column < 0) throw new Error(`${name} not on ${path}:${line}`);
  return column;
}

function match(path: string, line: number) {
  return { path, line, text: fixtureLines(path)[line - 1] };
}

let temp: string;

beforeAll(() => {
  temp = mkdtempSync(join(tmpdir(), 'difit-scip-peek-'));
});

afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

describe('answerFromScipIndex', () => {
  let index: ScipIndex;

  beforeAll(async () => {
    index = await convertScipIndex(join(FIXTURE_DIR, 'index.scip'));
  });

  const answer = (
    name: string,
    path: string,
    line: number,
    column: number,
    files = fixtureCommit(),
  ) => answerFromScipIndex(index, name, 'abc1234', { path, line, column }, files);

  it('answers with the declaration and uses of the symbol under the clicked name', async () => {
    const line = 17;
    const viaPort = await answer('findById', SERVICE, line, columnOf(SERVICE, line, 'findById'));
    const viaCache = await answer(
      'findById',
      SERVICE,
      line,
      columnOf(SERVICE, line, 'findById', 1) + 2,
    );

    expect(viaPort).toEqual({
      name: 'findById',
      ref: 'abc1234',
      definitions: [match(PORT, 6)],
      references: [match(SERVICE, line)],
      truncated: false,
      source: 'index',
    });
    expect(viaCache?.definitions).toEqual([match(CACHE, 6)]);
  });

  it('names the library when the declaration lives outside the repository', async () => {
    const line = 17;
    const result = await answer('orElse', SERVICE, line, columnOf(SERVICE, line, 'orElse'));

    expect(result).toMatchObject({
      definitions: [],
      // Both uses sit on one line, which shows once.
      references: [match(SERVICE, line)],
      source: 'index',
      library: 'java.util.Optional#orElse()',
    });
  });

  it('leaves out sites in files the commit does not hold', async () => {
    const line = 17;
    const column = columnOf(SERVICE, line, 'findById');

    const result = await answer('findById', SERVICE, line, column, fixtureCommit(PORT));

    expect(result).toMatchObject({
      definitions: [],
      references: [match(SERVICE, line)],
      source: 'index',
    });
    expect(result?.library).toBeUndefined();
    expect(await answer('findById', SERVICE, line, column, fixtureCommit(SERVICE))).toBeNull();
  });

  it('finds a Korean name by its UTF-16 column', async () => {
    const result = await answer('기본값', SERVICE, 16, 27);

    expect(result?.definitions).toEqual([match(SERVICE, 15)]);
    expect(result?.references).toEqual([match(SERVICE, 16), match(SERVICE, 17)]);
  });

  it('leaves the answer to name search when the index cannot give one', async () => {
    const line = 17;
    const findById = columnOf(SERVICE, line, 'findById');

    // Another name than the one under the column.
    expect(await answer('port', SERVICE, line, findById)).toBeNull();
    expect(await answer('find', SERVICE, line, findById)).toBeNull();
    // Nothing named there.
    expect(await answer('return', SERVICE, line, columnOf(SERVICE, line, 'return'))).toBeNull();
    // A file the index does not hold, or one that is not Java.
    expect(await answer('findById', 'src/main/java/demo/Gone.java', line, findById)).toBeNull();
    expect(await answer('findById', 'README.md', line, findById)).toBeNull();
    const stale: CommitFiles = {
      ...fixtureCommit(),
      readLines: async (paths) =>
        new Map(paths.map((path) => [path, fixtureLines(path).map(() => '')])),
    };
    expect(await answer('findById', SERVICE, line, findById, stale)).toBeNull();
  });

  it('keeps to the limits of name search', async () => {
    const uses = Array.from({ length: 501 }, (_, i) =>
      lengthDelimited(2, occurrence([i + 1, 0, 3], 'pkg A#foo().')),
    );
    const raw = Buffer.from(
      lengthDelimited(2, [
        ...text(1, 'A.java'),
        ...lengthDelimited(2, occurrence([0, 0, 3], 'pkg A#foo().', 1)),
        ...uses.flat(),
      ]),
    );
    const rawPath = join(temp, 'many.scip');
    writeFileSync(rawPath, raw);
    const many = await convertScipIndex(rawPath);
    const files: CommitFiles = {
      existing: async (paths) => new Set(paths),
      readLines: async (paths) =>
        new Map(paths.map((path) => [path, Array.from({ length: 502 }, () => 'foo();')])),
    };

    const result = await answerFromScipIndex(
      many,
      'foo',
      'HEAD',
      { path: 'A.java', line: 1, column: 0 },
      files,
    );

    expect(result?.definitions).toHaveLength(1);
    expect(result?.references).toHaveLength(500);
    expect(result?.truncated).toBe(true);
  });

  it('leaves the answer to name search when the index counts columns in bytes', async () => {
    const files: CommitFiles = {
      existing: async (paths) => new Set(paths),
      readLines: async (paths) => new Map(paths.map((path) => [path, ['foo();']])),
    };
    const answerIn = async (encoding: number) => {
      const rawPath = join(temp, `encoding-${encoding}.scip`);
      writeFileSync(
        rawPath,
        Buffer.from(
          lengthDelimited(2, [
            ...text(1, 'A.java'),
            ...lengthDelimited(2, occurrence([0, 0, 3], 'pkg A#foo().', 1)),
            ...varint(6 * 8),
            ...varint(encoding),
          ]),
        ),
      );
      const encoded = await convertScipIndex(rawPath);
      return answerFromScipIndex(
        encoded,
        'foo',
        'HEAD',
        { path: 'A.java', line: 1, column: 0 },
        files,
      );
    };

    expect(await answerIn(POSITION_ENCODING.utf8)).toBeNull();
    expect((await answerIn(POSITION_ENCODING.utf16))?.source).toBe('index');
  });
});

describe('commitFiles', () => {
  let repo: string;
  let first: string;

  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
        ),
        HOME: temp,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'difit',
        GIT_AUTHOR_EMAIL: 'difit@example.com',
        GIT_COMMITTER_NAME: 'difit',
        GIT_COMMITTER_EMAIL: 'difit@example.com',
      },
    }).trim();
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };

  beforeAll(() => {
    repo = join(temp, 'repo');
    mkdirSync(repo);
    git('init', '-q');
    write('src/A.java', 'class A {\r\n  int 값;\r\n}\r\n');
    write('src/with space.java', 'class B {}\n');
    write('src/dir/C.java', 'class C {}');
    git('add', '-A');
    git('commit', '-q', '-m', 'first');
    first = git('rev-parse', 'HEAD');
    write('src/A.java', 'class A2 {}\n');
    git('commit', '-q', '-am', 'second');
  });

  const asked = [
    'src/A.java',
    'src/missing.java',
    'src/with space.java',
    'src/dir',
    'build/generated/G.java',
    'src/dir/C.java',
    'src/A.java',
  ];

  it('reads the files of the given commit, not the latest ones', async () => {
    const lines = await commitFiles(repo, first).readLines(asked);

    expect([...lines.keys()]).toEqual(['src/A.java', 'src/with space.java', 'src/dir/C.java']);
    expect(lines.get('src/A.java')).toEqual(['class A {', '  int 값;', '}', '']);
    expect(lines.get('src/dir/C.java')).toEqual(['class C {}']);
  });

  it('tells which paths the commit holds as files', async () => {
    expect([...(await commitFiles(repo, first).existing(asked))]).toEqual([
      'src/A.java',
      'src/with space.java',
      'src/dir/C.java',
    ]);
  });

  it('stops when the caller gives up', async () => {
    const controller = new AbortController();
    controller.abort();
    const files = commitFiles(repo, first, controller.signal);

    await expect(files.readLines(['src/A.java'])).rejects.toThrow();
    await expect(files.existing(['src/A.java'])).rejects.toThrow();
  });
});

// Minimal protobuf writer for an index larger than the fixture.
function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return bytes;
}

function lengthDelimited(field: number, body: number[]): number[] {
  return [...varint(field * 8 + 2), ...varint(body.length), ...body];
}

function text(field: number, value: string): number[] {
  return lengthDelimited(field, [...Buffer.from(value, 'utf8')]);
}

function occurrence(range: number[], symbol: string, roles = 0): number[] {
  return [
    ...lengthDelimited(1, range.flatMap(varint)),
    ...text(2, symbol),
    ...(roles ? [...varint(3 * 8), ...varint(roles)] : []),
  ];
}

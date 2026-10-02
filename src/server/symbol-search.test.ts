import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { definitionMatcher, searchSymbol } from './symbol-search';

describe('definitionMatcher', () => {
  it.each([
    ['function parseDiff(input) {', 'parseDiff'],
    ['export default async function parseDiff() {', 'parseDiff'],
    ['export const parseDiff = (input: string): Diff => {', 'parseDiff'],
    ['  parseDiff: async (input) => input,', 'parseDiff'],
    ['  parseDiff = input => input;', 'parseDiff'],
    ['export class GitDiffParser {', 'GitDiffParser'],
    ['export interface DiffLine {', 'DiffLine'],
    ['type DiffSide = "old" | "new";', 'DiffSide'],
    ['  async parseDiff(selection: DiffSelection): Promise<Diff> {', 'parseDiff'],
    ['  private normalize(path: string) {', 'normalize'],
    ['    public static List<String> findAll(Long id) throws IOException {', 'findAll'],
    ['    @Override public void run() {', 'run'],
    ['    Optional<User> findByName(String name);', 'findByName'],
    ['    public UserService(UserRepository repository) {', 'UserService'],
    ['    default void reset() {', 'reset'],
    ['  public: void run();', 'run'],
    ['  private: static Foo* create(int a);', 'create'],
    ['Q_SIGNALS: void changed(int x);', 'changed'],
    ['  internal: void run();', 'run'],
    ['T&& forward(T& x);', 'forward'],
    ['  std::string&& take();', 'take'],
    ['  const Foo & get() const;', 'get'],
    ['  char * name(int a);', 'name'],
    ['  public static <K, V> Map<K, ? extends V> copy(Map<K, V> src) {', 'copy'],
    ['  public static Map<String, ? extends List<Foo>> load(int a) {', 'load'],
    ['  Map<Class<?>, ? extends Foo> load(int a);', 'load'],
    ['def parse_diff(text):', 'parse_diff'],
    ['  def self.parse(text)', 'parse'],
    ['func (p *Parser) Parse(input string) error {', 'Parse'],
    ['pub fn parse_diff(input: &str) -> Diff {', 'parse_diff'],
    ['fun parseDiff(input: String): Diff {', 'parseDiff'],
    ['build_site() {', 'build_site'],
  ])('finds the declaration in %s', (text, name) => {
    expect(definitionMatcher(name)(text)).toBe(true);
  });

  it.each([
    ['  parseDiff(input);', 'parseDiff'],
    ['  const diff = parseDiff(input);', 'parseDiff'],
    ['  return parseDiff(input);', 'parseDiff'],
    ['  if (parseDiff(input)) {', 'parseDiff'],
    ['  await this.parser.parseDiff(selection);', 'parseDiff'],
    ['  const parser = new GitDiffParser(repoPath);', 'GitDiffParser'],
    ['    && isValid(name)', 'isValid'],
    ['  items.forEach((item) => {', 'forEach'],
    ['  register(() => {', 'register'],
    ['import { parseDiff } from "./git-diff";', 'parseDiff'],
    ['  } else parseDiff(input);', 'parseDiff'],
    ['    if is_valid(x):', 'is_valid'],
    ['    elif is_valid(x):', 'is_valid'],
    ['    for item in load_items(path):', 'load_items'],
    ['    while has_more(cursor):', 'has_more'],
    ['    with open_db(path) as db:', 'open_db'],
    ['    raise ConfigError(message)', 'ConfigError'],
    ['\tdefer cleanup()', 'cleanup'],
    ['\tgo worker(ch)', 'worker'],
    ['  puts format(x)', 'format'],
    ['export default connect(store);', 'connect'],
    ['import { type DiffLine } from "./diff";', 'DiffLine'],
    ['export { type DiffLine } from "./diff";', 'DiffLine'],
    ['from diff import parse_diff', 'parse_diff'],
    ['    async with open_db(path) as db:', 'open_db'],
    ['    async for item in load_items(path):', 'load_items'],
    ['  yield* walk(child);', 'walk'],
    ['    try parse(data)', 'parse'],
    ['    else: handle(x)', 'handle'],
    ['    default: return handle(x);', 'handle'],
    ['  parser: new GitDiffParser(repoPath),', 'GitDiffParser'],
    ['  result: await fetchData(url),', 'fetchData'],
    ['    finally: return cleanup(x)', 'cleanup'],
    ['    except: return handle(x)', 'handle'],
    ['  retry: return attempt(x);', 'attempt'],
    ['  isReady && callback(value);', 'callback'],
    ['  isReady || fallback(value);', 'fallback'],
    ['    cond ? handle(a) : other(b)', 'handle'],
    ['  ready && await save(x);', 'save'],
    ['  user && new Foo(x);', 'Foo'],
    ['  ready ? await load(x) : null;', 'load'],
    ['  a < b && c > handle(x);', 'handle'],
    ['  value ?? compute(x);', 'compute'],
    ['  count > limit(x);', 'limit'],
    ['  total == expected(x);', 'expected'],
  ])('does not take the use in %s for a declaration', (text, name) => {
    expect(definitionMatcher(name)(text)).toBe(false);
  });
});

describe('searchSymbol', () => {
  let home: string;
  let repo: string;
  let firstCommit: string;
  const savedEnv = { ...process.env };

  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'difit-symbol-home-'));
    process.env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
    );
    Object.assign(process.env, {
      HOME: home,
      XDG_CONFIG_HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'difit',
      GIT_AUTHOR_EMAIL: 'difit@example.com',
      GIT_COMMITTER_NAME: 'difit',
      GIT_COMMITTER_EMAIL: 'difit@example.com',
    });

    repo = mkdtempSync(join(tmpdir(), 'difit-symbol-'));
    git('init', '-q');
    write('src/math.ts', 'export function addOne(n: number) {\n  return n + 1;\n}\n');
    write('src/use.ts', 'import { addOne } from "./math";\n\nexport const two = addOne(1);\n');
    write('README.md', 'Call addOne(n) to add one.\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    firstCommit = git('rev-parse', '--short', 'HEAD');

    write('src/math.ts', 'export function addTwo(n: number) {\n  return n + 2;\n}\n');
    git('commit', '-q', '-am', 'rename');
  });

  afterAll(() => {
    process.env = savedEnv;
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('searches the commit it is given, not the files on disk', async () => {
    const result = await searchSymbol(repo, 'addOne', firstCommit, 'src/use.ts');

    expect(result.definitions).toEqual([
      { path: 'src/math.ts', line: 1, text: 'export function addOne(n: number) {' },
    ]);
    expect(result.references.map((match) => `${match.path}:${match.line}`)).toEqual([
      'README.md:1',
      'src/use.ts:1',
      'src/use.ts:3',
    ]);
    expect(result.truncated).toBe(false);
  });

  it('searches the working tree, including files git does not track yet', async () => {
    write('src/new.ts', 'export function addThree(n: number) {\n  return n + 3;\n}\n');

    const result = await searchSymbol(repo, 'addThree', 'working');

    expect(result.definitions.map((match) => `${match.path}:${match.line}`)).toEqual([
      'src/new.ts:1',
    ]);
    rmSync(join(repo, 'src/new.ts'));
  });

  it('searches the index for staged', async () => {
    write('src/math.ts', 'export function addFour(n: number) {\n  return n + 4;\n}\n');
    git('add', 'src/math.ts');
    write('src/math.ts', 'export function addFive(n: number) {\n  return n + 5;\n}\n');

    expect((await searchSymbol(repo, 'addFour', 'staged')).definitions).toHaveLength(1);
    expect((await searchSymbol(repo, 'addFive', 'staged')).definitions).toHaveLength(0);
    git('checkout', 'HEAD', '--', 'src/math.ts');
  });

  it('returns nothing when the name appears nowhere', async () => {
    const result = await searchSymbol(repo, 'missingName', 'HEAD');

    expect(result).toEqual({
      name: 'missingName',
      ref: 'HEAD',
      definitions: [],
      references: [],
      truncated: false,
    });
  });

  it('keeps every declaration when the uses pass the limit', async () => {
    write('src/a-uses.ts', 'manyUses();\n'.repeat(600));
    write('src/z-decl.ts', 'export function manyUses() {}\n');
    git('add', '.');
    git('commit', '-q', '-m', 'many uses');

    const result = await searchSymbol(repo, 'manyUses', 'HEAD');

    expect(result.definitions.map((match) => match.path)).toEqual(['src/z-decl.ts']);
    expect(result.references).toHaveLength(500);
    expect(result.truncated).toBe(true);
  });

  it('stops listing declarations of a name that is declared everywhere', async () => {
    write('src/locals.ts', 'function f() {\n  const result = 1;\n}\n'.repeat(250));
    git('add', '.');
    git('commit', '-q', '-m', 'many locals');

    write('src/zz-late.ts', 'export function late() {\n  const result = 2;\n}\n');
    git('add', '.');
    git('commit', '-q', '-m', 'one more');

    const result = await searchSymbol(repo, 'result', 'HEAD', 'src/zz-late.ts');

    expect(result.definitions).toHaveLength(200);
    expect(result.definitions[0]?.path).toBe('src/zz-late.ts');
    expect(result.truncated).toBe(true);
  });

  it('stops when the caller gives up', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      searchSymbol(repo, 'addOne', 'HEAD', undefined, controller.signal),
    ).rejects.toThrow();
  });

  it('fails when git cannot read the revision', async () => {
    await expect(searchSymbol(repo, 'addOne', 'no-such-branch')).rejects.toThrow();
  });

  it('cuts very long lines short', async () => {
    write('data.ts', `const table = [${'addSix, '.repeat(100)}];\n`);
    git('add', 'data.ts');
    git('commit', '-q', '-m', 'long line');

    const [match] = (await searchSymbol(repo, 'addSix', 'HEAD')).references;

    expect(match?.text.length).toBe(241);
    expect(match?.text.endsWith('…')).toBe(true);
  });
});

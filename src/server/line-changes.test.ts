import { describe, expect, it } from 'vitest';

import { parseLineChanges } from './line-changes';

const diff = [
  'diff --git a/src/A.java b/src/A.java',
  'index 1111111..2222222 100644',
  '--- a/src/A.java',
  '+++ b/src/A.java',
  '@@ -2,0 +3,2 @@ class A {',
  '+    // one',
  '+    // two',
  '@@ -5 +7 @@ class A {',
  '-    int old;',
  '+    int now;',
  '@@ -8,2 +9,0 @@ class A {',
  '-    int gone;',
  '-    int gone2;',
  'diff --git a/src/Old.java b/src/New.java',
  'similarity index 100%',
  'rename from src/Old.java',
  'rename to src/New.java',
  'diff --git a/src/Gone.java b/src/Gone.java',
  'deleted file mode 100644',
  '--- a/src/Gone.java',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-class Gone {}',
  'diff --git a/src/Added.java b/src/Added.java',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/Added.java',
  '@@ -0,0 +1 @@',
  '+class Added {}',
  '',
].join('\n');

describe('parseLineChanges', () => {
  const changes = parseLineChanges(diff)!;

  it('follows a line the newer commit left as it was back to the older commit', () => {
    expect(changes.toOlder('src/A.java', 1)).toEqual({ path: 'src/A.java', line: 1 });
    expect(changes.toOlder('src/A.java', 6)).toEqual({ path: 'src/A.java', line: 4 });
    expect(changes.toOlder('src/A.java', 8)).toEqual({ path: 'src/A.java', line: 6 });
    expect(changes.toOlder('src/A.java', 9)).toEqual({ path: 'src/A.java', line: 7 });
    expect(changes.toOlder('src/A.java', 10)).toEqual({ path: 'src/A.java', line: 10 });
    expect(changes.toOlder('src/New.java', 3)).toEqual({ path: 'src/Old.java', line: 3 });
    expect(changes.toOlder('src/Same.java', 3)).toEqual({ path: 'src/Same.java', line: 3 });
  });

  it('has no older line for a line added or changed since', () => {
    expect(changes.toOlder('src/A.java', 3)).toBeNull();
    expect(changes.toOlder('src/A.java', 4)).toBeNull();
    expect(changes.toOlder('src/A.java', 7)).toBeNull();
    expect(changes.toOlder('src/Added.java', 1)).toBeNull();
  });

  it('follows an older line forward, or gives the lines that replaced it', () => {
    expect(changes.toNewer('src/A.java', 4)).toEqual({ path: 'src/A.java', line: 6 });
    expect(changes.toNewer('src/A.java', 10)).toEqual({ path: 'src/A.java', line: 10 });
    expect(changes.toNewer('src/A.java', 5)).toEqual({ path: 'src/A.java', first: 7, last: 7 });
    expect(changes.toNewer('src/Old.java', 2)).toEqual({ path: 'src/New.java', line: 2 });
  });

  it('has no newer line for a line or a file removed since', () => {
    expect(changes.toNewer('src/A.java', 8)).toBeNull();
    expect(changes.toNewer('src/A.java', 9)).toBeNull();
    expect(changes.toNewer('src/Gone.java', 1)).toBeNull();
  });

  it('reads a path holding a space, which the header ends with a tab', () => {
    const spaced = parseLineChanges(
      [
        'diff --git a/src/My File.java b/src/My File.java',
        '--- a/src/My File.java\t',
        '+++ b/src/My File.java\t',
        '@@ -0,0 +1 @@',
        '+z',
        '',
      ].join('\n'),
    )!;
    expect(spaced.toOlder('src/My File.java', 1)).toBeNull();
    expect(spaced.toOlder('src/My File.java', 2)).toEqual({ path: 'src/My File.java', line: 1 });
  });

  it('gives up on a diff that names a path git had to quote', () => {
    const quoted = [
      'diff --git "a/src/tab\\there.java" "b/src/tab\\there.java"',
      '--- "a/src/tab\\there.java"',
      '+++ "b/src/tab\\there.java"',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '',
    ].join('\n');
    expect(parseLineChanges(quoted)).toBeNull();
  });

  it('gives up on a diff that shows a Java file only as binary', () => {
    const binary = [
      'diff --git a/A.java b/A.java',
      'index f098e84..6e94eff 100644',
      'Binary files a/A.java and b/A.java differ',
      '',
    ].join('\n');
    expect(parseLineChanges(binary)).toBeNull();
    const quoted = [
      'diff --git "a/We\\tird.java" "b/We\\tird.java"',
      'index 2e2439c..eee3e17 100644',
      'Binary files "a/We\\tird.java" and "b/We\\tird.java" differ',
      '',
    ].join('\n');
    expect(parseLineChanges(quoted)).toBeNull();
  });

  it('follows the Java lines of a diff that also changes a binary file', () => {
    const withImage = parseLineChanges(
      [
        'diff --git a/i.png b/i.png',
        'new file mode 100644',
        'index 0000000..f584f40',
        'Binary files /dev/null and b/i.png differ',
        'diff --git a/A.java b/A.java',
        '--- a/A.java',
        '+++ b/A.java',
        '@@ -1,0 +2 @@',
        '+z',
        '',
      ].join('\n'),
    )!;
    expect(withImage.toOlder('A.java', 3)).toEqual({ path: 'A.java', line: 2 });
  });
});

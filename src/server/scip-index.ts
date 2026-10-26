import { createWriteStream } from 'fs';
import { type FileHandle, open, readFile, rename, rm } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { createGzip, gunzip } from 'zlib';

// Lookup-only view of a SCIP index (https://github.com/sourcegraph/scip, scip.proto),
// decoded by hand so the raw file never becomes one big object graph.

interface ScipSite {
  path: string;
  // 1-based, like the line numbers of name search.
  line: number;
  // 0-based and end exclusive, in the indexer's unit. scip-java leaves positionEncoding
  // unspecified and counts UTF-16 code units, the same as JavaScript string indexes.
  // endCol equals startCol when the range runs onto later lines and has no one-line
  // enclosing range to stand in for it.
  startCol: number;
  endCol: number;
}

export interface ScipLookupResult {
  symbol: string;
  definitions: ScipSite[];
  references: ScipSite[];
  // No document of the index defines the symbol or the type it belongs to, so it lives in
  // a library. Never set for packages.
  external: boolean;
}

// scip.proto PositionEncoding.
export const POSITION_ENCODING = {
  unspecified: 0,
  utf8: 1,
  utf16: 2,
  utf32: 3,
} as const;

const FORMAT_MAGIC = 0x50435344; // "DSCP" read as a little-endian int32
const FORMAT_VERSION = 1;
const HEADER_WORDS = 8;
// Per occurrence: line, startCol, endCol, symbolId * 2 + isDefinition.
const OCC_WORDS = 4;
const MULTI_LINE_END = 0x7fffffff;
const ROLE_DEFINITION = 1;

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

const DEFAULT_CHUNK_BYTES = 1 << 20;
const DEFAULT_SLICE_MS = 8;
const LOOP_CHECK_INTERVAL = 4096;

interface CompactData {
  positionEncoding: number;
  docPaths: string[];
  // Occurrences of document d are occ[docStart[d] .. docStart[d + 1]), sorted by position.
  docStart: Int32Array;
  occ: Int32Array;
  symbolCount: number;
  // Occurrence indexes of symbol s are symOcc[symOccStart[s] .. symOccStart[s + 1]).
  symOccStart: Int32Array;
  symOcc: Int32Array;
  strings: { offsets: Int32Array; blob: Buffer };
}

export class ScipIndex {
  private readonly docByPath = new Map<string, number>();

  constructor(private readonly data: CompactData) {
    data.docPaths.forEach((path, doc) => {
      if (!this.docByPath.has(path)) this.docByPath.set(path, doc);
    });
  }

  get positionEncoding(): number {
    return this.data.positionEncoding;
  }

  hasDocument(path: string): boolean {
    return this.docByPath.has(path);
  }

  // `line` is 1-based and `column` 0-based, in the same unit as the sites' columns.
  lookup(path: string, line: number, column: number): ScipLookupResult | null {
    const doc = this.docByPath.get(path);
    if (doc === undefined) return null;
    const { docStart, occ } = this.data;
    const line0 = line - 1;
    const end = docStart[doc + 1] ?? 0;
    let lo = docStart[doc] ?? 0;
    let hi = end;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((occ[mid * OCC_WORDS] ?? 0) < line0) lo = mid + 1;
      else hi = mid;
    }
    let best = -1;
    let bestWidth = Infinity;
    for (let i = lo; i < end && occ[i * OCC_WORDS] === line0; i++) {
      const start = occ[i * OCC_WORDS + 1] ?? 0;
      const stop = occ[i * OCC_WORDS + 2] ?? 0;
      if (column < start || column >= stop) continue;
      // Nested ranges on one spot (an annotation and its type, say): the innermost wins.
      if (stop - start < bestWidth) {
        best = i;
        bestWidth = stop - start;
      }
    }
    if (best < 0) return null;
    return this.resultFor((occ[best * OCC_WORDS + 3] ?? 0) >>> 1);
  }

  private resultFor(symbol: number): ScipLookupResult {
    const { definitions, references } = this.sitesOf(symbol);
    const name = this.symbolName(symbol);
    // A package ("/" ends its descriptor) has no definition occurrence even in the
    // repository, so its lack of one says nothing about where it lives.
    if (definitions.length > 0 || name.endsWith('/')) {
      return { symbol: name, definitions, references, external: false };
    }
    // Members the compiler adds, such as an enum's values() or a default constructor, are
    // never defined; the declaration of their type stands in when the repository has it.
    const owner = ownerTypeOf(name);
    const ownerId = owner === null ? undefined : this.symbolId(owner);
    const ownerDefinitions = ownerId === undefined ? [] : this.sitesOf(ownerId).definitions;
    return {
      symbol: name,
      definitions: ownerDefinitions,
      references,
      external: ownerDefinitions.length === 0,
    };
  }

  private symbolName(id: number): string {
    const { docPaths, strings } = this.data;
    const i = docPaths.length + id;
    return strings.blob.toString('utf8', strings.offsets[i] ?? 0, strings.offsets[i + 1] ?? 0);
  }

  private symbolId(name: string): number | undefined {
    const { docPaths, strings, symbolCount } = this.data;
    const wanted = Buffer.from(name, 'utf8');
    for (let id = 0; id < symbolCount; id++) {
      const start = strings.offsets[docPaths.length + id] ?? 0;
      const end = strings.offsets[docPaths.length + id + 1] ?? 0;
      if (
        end - start === wanted.length &&
        strings.blob.compare(wanted, 0, wanted.length, start, end) === 0
      ) {
        return id;
      }
    }
    return undefined;
  }

  private sitesOf(symbol: number): { definitions: ScipSite[]; references: ScipSite[] } {
    const { symOccStart, symOcc, occ } = this.data;
    const definitions: ScipSite[] = [];
    const references: ScipSite[] = [];
    const end = symOccStart[symbol + 1] ?? 0;
    for (let k = symOccStart[symbol] ?? 0; k < end; k++) {
      const i = symOcc[k] ?? 0;
      const startCol = occ[i * OCC_WORDS + 1] ?? 0;
      const endCol = occ[i * OCC_WORDS + 2] ?? 0;
      const site: ScipSite = {
        path: this.data.docPaths[this.docOf(i)] ?? '',
        line: (occ[i * OCC_WORDS] ?? 0) + 1,
        startCol,
        endCol: endCol === MULTI_LINE_END ? startCol : endCol,
      };
      if (((occ[i * OCC_WORDS + 3] ?? 0) & 1) === 1) definitions.push(site);
      else references.push(site);
    }
    return { definitions, references };
  }

  private docOf(occIndex: number): number {
    const { docStart } = this.data;
    let lo = 0;
    let hi = docStart.length - 1;
    // The last document starting at or before occIndex; empty documents share a start with the next one.
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if ((docStart[mid] ?? 0) <= occIndex) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  toBuffers(): Buffer[] {
    const { data } = this;
    const header = new Int32Array(HEADER_WORDS);
    header[0] = FORMAT_MAGIC;
    header[1] = FORMAT_VERSION;
    header[2] = data.positionEncoding;
    header[3] = data.docPaths.length;
    header[4] = data.symbolCount;
    header[5] = data.occ.length / OCC_WORDS;
    header[6] = data.strings.blob.length;
    return [header, data.strings.offsets, data.docStart, data.occ, data.symOccStart, data.symOcc]
      .map((array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength))
      .concat(data.strings.blob);
  }
}

const gunzipAsync = promisify(gunzip);

// Gzipped, and written atomically so a file at `outPath` is always a finished index.
export async function writeScipIndex(index: ScipIndex, outPath: string): Promise<void> {
  const tmpPath = `${outPath}.${process.pid}.tmp`;
  try {
    await pipeline(Readable.from(index.toBuffers()), createGzip(), createWriteStream(tmpPath));
    await rename(tmpPath, outPath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

// Null when there is no file or it is not a whole index of this format version.
export async function readScipIndex(path: string): Promise<ScipIndex | null> {
  let compressed: Buffer;
  try {
    compressed = await readFile(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  let file: Buffer;
  try {
    file = await gunzipAsync(compressed);
  } catch {
    return null;
  }
  if (file.byteOffset % 4 !== 0) {
    const aligned = Buffer.alloc(file.length);
    file.copy(aligned);
    file = aligned;
  }
  if (file.length < HEADER_WORDS * 4) return null;
  const header = new Int32Array(file.buffer, file.byteOffset, HEADER_WORDS);
  if (header[0] !== FORMAT_MAGIC || header[1] !== FORMAT_VERSION) return null;
  const positionEncoding = header[2] ?? 0;
  const docCount = header[3] ?? 0;
  const symbolCount = header[4] ?? 0;
  const occCount = header[5] ?? 0;
  const blobBytes = header[6] ?? 0;
  if (Math.min(docCount, symbolCount, occCount, blobBytes) < 0) return null;

  let offset = HEADER_WORDS * 4;
  const take = (words: number): Int32Array => {
    const array = new Int32Array(file.buffer, file.byteOffset + offset, words);
    offset += words * 4;
    return array;
  };
  const expected =
    offset +
    4 * (docCount + symbolCount + 1 + docCount + 1 + occCount * OCC_WORDS) +
    4 * (symbolCount + 1 + occCount) +
    blobBytes;
  if (file.length !== expected) return null;

  const offsets = take(docCount + symbolCount + 1);
  const docStart = take(docCount + 1);
  const occ = take(occCount * OCC_WORDS);
  const symOccStart = take(symbolCount + 1);
  const symOcc = take(occCount);
  const blob = file.subarray(offset, offset + blobBytes);

  const docPaths: string[] = [];
  for (let d = 0; d < docCount; d++) {
    docPaths.push(blob.toString('utf8', offsets[d] ?? 0, offsets[d + 1] ?? 0));
  }
  return new ScipIndex({
    positionEncoding,
    docPaths,
    docStart,
    occ,
    symbolCount,
    symOccStart,
    symOcc,
    strings: { offsets, blob },
  });
}

export interface ConvertOptions {
  chunkBytes?: number;
  // Longest stretch of work before giving the event loop a turn.
  sliceMs?: number;
  // Checked between slices; an aborted conversion rejects with the signal's reason.
  signal?: AbortSignal;
}

// Reads a raw index.scip into the lookup form, a document at a time, yielding to the
// event loop between slices so a server in the same process keeps answering.
export async function convertScipIndex(
  rawPath: string,
  options: ConvertOptions = {},
): Promise<ScipIndex> {
  const slicer = new Slicer(options.sliceMs ?? DEFAULT_SLICE_MS, options.signal);
  const handle = await open(rawPath, 'r');
  const builder = new IndexBuilder();
  try {
    const reader = new FileReader(handle, options.chunkBytes ?? DEFAULT_CHUNK_BYTES);
    for (;;) {
      const tag = await reader.varint();
      if (tag === null) break;
      const field = Math.floor(tag / 8);
      const wire = tag % 8;
      if (wire === WIRE_LENGTH_DELIMITED) {
        const length = await reader.requireVarint();
        if (field === 2) {
          builder.addDocument(await reader.bytes(length));
          await slicer.maybeYield();
        } else {
          await reader.skip(length);
        }
      } else if (wire === WIRE_VARINT) {
        await reader.requireVarint();
      } else if (wire === WIRE_FIXED64) {
        await reader.skip(8);
      } else if (wire === WIRE_FIXED32) {
        await reader.skip(4);
      } else {
        throw new Error(`Unsupported protobuf wire type ${wire} in SCIP index`);
      }
    }
  } finally {
    await handle.close();
  }
  return builder.finish(slicer);
}

class Slicer {
  private sliceStart = performance.now();

  constructor(
    private readonly budgetMs: number,
    private readonly signal?: AbortSignal,
  ) {}

  async maybeYield(): Promise<void> {
    this.signal?.throwIfAborted();
    if (performance.now() - this.sliceStart < this.budgetMs) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.signal?.throwIfAborted();
    this.sliceStart = performance.now();
  }
}

class GrowableInt32 {
  private array = new Int32Array(1024);
  length = 0;

  push(value: number): void {
    if (this.length === this.array.length) {
      const next = new Int32Array(this.array.length * 2);
      next.set(this.array);
      this.array = next;
    }
    this.array[this.length++] = value;
  }

  toArray(): Int32Array {
    return this.array.slice(0, this.length);
  }
}

class IndexBuilder {
  private positionEncoding: number = POSITION_ENCODING.unspecified;
  private readonly docPaths: string[] = [];
  private readonly docStart = new GrowableInt32();
  private readonly occ = new GrowableInt32();
  // Keyed by the symbol's bytes read as latin1, which is cheaper than decoding UTF-8.
  private readonly globalIds = new Map<string, number>();
  private readonly symbols: string[] = [];

  constructor() {
    this.docStart.push(0);
  }

  addDocument(buffer: Buffer): void {
    const doc = new ProtoReader(buffer, 0, buffer.length);
    const localIds = new Map<string, number>();
    let path = '';
    const lines: number[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    const symbols: number[] = [];

    while (!doc.done()) {
      const tag = doc.varint();
      const field = Math.floor(tag / 8);
      const wire = tag % 8;
      if (field === 1 && wire === WIRE_LENGTH_DELIMITED) {
        const [start, end] = doc.lengthDelimited();
        path = buffer.toString('utf8', start, end);
      } else if (field === 2 && wire === WIRE_LENGTH_DELIMITED) {
        const [start, end] = doc.lengthDelimited();
        const occurrence = readOccurrence(buffer, start, end);
        if (occurrence === null) continue;
        const symbol = this.symbolId(
          buffer,
          occurrence.symbolStart,
          occurrence.symbolEnd,
          localIds,
        );
        lines.push(occurrence.line);
        starts.push(occurrence.startCol);
        ends.push(occurrence.endCol);
        symbols.push(symbol * 2 + (occurrence.isDefinition ? 1 : 0));
      } else if (field === 6 && wire === WIRE_VARINT) {
        const encoding = doc.varint();
        if (this.positionEncoding === POSITION_ENCODING.unspecified) {
          this.positionEncoding = encoding;
        }
      } else {
        doc.skip(wire);
      }
    }

    const order = lines.map((_, i) => i);
    order.sort(
      (a, b) =>
        (lines[a] ?? 0) - (lines[b] ?? 0) ||
        (starts[a] ?? 0) - (starts[b] ?? 0) ||
        (ends[a] ?? 0) - (ends[b] ?? 0),
    );
    for (const i of order) {
      this.occ.push(lines[i] ?? 0);
      this.occ.push(starts[i] ?? 0);
      this.occ.push(ends[i] ?? 0);
      this.occ.push(symbols[i] ?? 0);
    }
    this.docPaths.push(path);
    this.docStart.push(this.occ.length / OCC_WORDS);
  }

  private symbolId(
    buffer: Buffer,
    start: number,
    end: number,
    localIds: Map<string, number>,
  ): number {
    const key = buffer.toString('latin1', start, end);
    // Local symbols ("local 3") are only unique within their document.
    const ids = key.startsWith('local ') ? localIds : this.globalIds;
    let id = ids.get(key);
    if (id === undefined) {
      id = this.symbols.length;
      this.symbols.push(buffer.toString('utf8', start, end));
      ids.set(key, id);
    }
    return id;
  }

  async finish(slicer: Slicer): Promise<ScipIndex> {
    const occ = this.occ.toArray();
    const occCount = occ.length / OCC_WORDS;
    const symbolCount = this.symbols.length;

    const symOccStart = new Int32Array(symbolCount + 1);
    for (let i = 0; i < occCount; i++) {
      symOccStart[((occ[i * OCC_WORDS + 3] ?? 0) >>> 1) + 1]++;
      if (i % LOOP_CHECK_INTERVAL === 0) await slicer.maybeYield();
    }
    for (let s = 0; s < symbolCount; s++) {
      symOccStart[s + 1] = (symOccStart[s + 1] ?? 0) + (symOccStart[s] ?? 0);
    }
    const fill = symOccStart.slice(0, symbolCount);
    const symOcc = new Int32Array(occCount);
    for (let i = 0; i < occCount; i++) {
      const symbol = (occ[i * OCC_WORDS + 3] ?? 0) >>> 1;
      symOcc[fill[symbol] ?? 0] = i;
      fill[symbol] = (fill[symbol] ?? 0) + 1;
      if (i % LOOP_CHECK_INTERVAL === 0) await slicer.maybeYield();
    }

    const strings = encodeStrings([...this.docPaths, ...this.symbols]);
    return new ScipIndex({
      positionEncoding: this.positionEncoding,
      docPaths: this.docPaths,
      docStart: this.docStart.toArray(),
      occ,
      symbolCount,
      symOccStart,
      symOcc,
      strings,
    });
  }
}

function encodeStrings(values: string[]): { offsets: Int32Array; blob: Buffer } {
  const parts = values.map((value) => Buffer.from(value, 'utf8'));
  const offsets = new Int32Array(values.length + 1);
  parts.forEach((part, i) => {
    offsets[i + 1] = (offsets[i] ?? 0) + part.length;
  });
  return { offsets, blob: Buffer.concat(parts) };
}

interface DecodedOccurrence {
  line: number;
  startCol: number;
  endCol: number;
  symbolStart: number;
  symbolEnd: number;
  isDefinition: boolean;
}

function readOccurrence(buffer: Buffer, start: number, end: number): DecodedOccurrence | null {
  const reader = new ProtoReader(buffer, start, end);
  const range: number[] = [];
  const enclosing: number[] = [];
  let symbolStart = 0;
  let symbolEnd = 0;
  let roles = 0;
  while (!reader.done()) {
    const tag = reader.varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if ((field === 1 || field === 7) && wire === WIRE_LENGTH_DELIMITED) {
      const [packedStart, packedEnd] = reader.lengthDelimited();
      const packed = new ProtoReader(buffer, packedStart, packedEnd);
      const target = field === 1 ? range : enclosing;
      while (!packed.done()) target.push(packed.varint());
    } else if ((field === 1 || field === 7) && wire === WIRE_VARINT) {
      (field === 1 ? range : enclosing).push(reader.varint());
    } else if (field === 2 && wire === WIRE_LENGTH_DELIMITED) {
      [symbolStart, symbolEnd] = reader.lengthDelimited();
    } else if (field === 3 && wire === WIRE_VARINT) {
      roles = reader.varint();
    } else {
      reader.skip(wire);
    }
  }
  if (symbolEnd === symbolStart) return null;
  if (range.some((value) => value >= MULTI_LINE_END)) return null;
  let span = singleLineSpan(range);
  if (span === null) {
    if (range.length !== 4) return null;
    // A range that runs onto later lines (Lombok puts a generated getter's definition
    // there) is replaced by its enclosing range when that stays on one line; otherwise
    // it covers the rest of its first line.
    const outer = singleLineSpan(enclosing);
    span =
      outer !== null && outer[2] > outer[1]
        ? outer
        : [range[0] ?? 0, range[1] ?? 0, MULTI_LINE_END];
  }
  return {
    line: span[0],
    startCol: span[1],
    endCol: span[2],
    symbolStart,
    symbolEnd,
    isDefinition: (roles & ROLE_DEFINITION) !== 0,
  };
}

function singleLineSpan(range: number[]): [line: number, startCol: number, endCol: number] | null {
  if (range.some((value) => value >= MULTI_LINE_END)) return null;
  const [line = 0, startCol = 0] = range;
  if (range.length === 3) return [line, startCol, range[2] ?? 0];
  if (range.length === 4 && range[2] === line) return [line, startCol, range[3] ?? 0];
  return null;
}

class ProtoReader {
  constructor(
    private readonly buffer: Buffer,
    private pos: number,
    private readonly end: number,
  ) {}

  get position(): number {
    return this.pos;
  }

  done(): boolean {
    return this.pos >= this.end;
  }

  varint(): number {
    let result = 0;
    let scale = 1;
    for (;;) {
      if (this.pos >= this.end) throw new Error('Truncated varint in SCIP index');
      const byte = this.buffer[this.pos++] ?? 0;
      result += (byte & 0x7f) * scale;
      if (byte < 0x80) return result;
      scale *= 128;
    }
  }

  lengthDelimited(): [number, number] {
    const length = this.varint();
    const start = this.pos;
    this.pos += length;
    if (this.pos > this.end) throw new Error('Truncated field in SCIP index');
    return [start, this.pos];
  }

  skip(wire: number): void {
    if (wire === WIRE_VARINT) this.varint();
    else if (wire === WIRE_LENGTH_DELIMITED) this.lengthDelimited();
    else if (wire === WIRE_FIXED64) this.pos += 8;
    else if (wire === WIRE_FIXED32) this.pos += 4;
    else throw new Error(`Unsupported protobuf wire type ${wire} in SCIP index`);
  }
}

// Reads the top level of the raw file without holding all of it.
class FileReader {
  private buffer = Buffer.alloc(0);
  private pos = 0;
  private filePos = 0;

  constructor(
    private readonly handle: FileHandle,
    private readonly chunkBytes: number,
  ) {}

  private get available(): number {
    return this.buffer.length - this.pos;
  }

  // Tries to have `wanted` unread bytes in the buffer; fewer only at end of file.
  private async fill(wanted: number): Promise<void> {
    if (this.available >= wanted) return;
    const next = Buffer.allocUnsafe(Math.max(wanted, this.chunkBytes));
    const kept = this.buffer.copy(next, 0, this.pos);
    let filled = kept;
    while (filled < wanted) {
      const { bytesRead } = await this.handle.read(
        next,
        filled,
        next.length - filled,
        this.filePos,
      );
      if (bytesRead === 0) break;
      filled += bytesRead;
      this.filePos += bytesRead;
    }
    this.buffer = next.subarray(0, filled);
    this.pos = 0;
  }

  // Null at a clean end of file.
  async varint(): Promise<number | null> {
    await this.fill(10);
    if (this.available === 0) return null;
    const reader = new ProtoReader(this.buffer, this.pos, this.buffer.length);
    const value = reader.varint();
    this.pos = reader.position;
    return value;
  }

  async requireVarint(): Promise<number> {
    const value = await this.varint();
    if (value === null) throw new Error('Truncated SCIP index');
    return value;
  }

  async bytes(length: number): Promise<Buffer> {
    await this.fill(length);
    if (this.available < length) throw new Error('Truncated SCIP index');
    const bytes = this.buffer.subarray(this.pos, this.pos + length);
    this.pos += length;
    return bytes;
  }

  async skip(length: number): Promise<void> {
    if (this.available >= length) {
      this.pos += length;
      return;
    }
    this.filePos += length - this.available;
    this.buffer = Buffer.alloc(0);
    this.pos = 0;
    await this.fill(0);
  }
}

// "… demo/Op#values()." → "… demo/Op#"; null when the symbol is not a member of a type.
function ownerTypeOf(symbol: string): string | null {
  const hash = symbol.lastIndexOf('#', symbol.length - 2);
  return hash < 0 ? null : symbol.slice(0, hash + 1);
}

// "semanticdb maven maven/org.springframework.data/spring-data-commons 2.7.0
// org/springframework/data/repository/CrudRepository#save()." becomes
// "org.springframework.data.repository.CrudRepository#save()". Best effort: a symbol
// that does not parse comes back unchanged.
export function externalSymbolDisplayName(symbol: string): string {
  const descriptors = descriptorPart(symbol);
  if (descriptors === null) return symbol;
  const parsed = parseDescriptors(descriptors);
  if (parsed === null) return symbol;
  const owners: string[] = [];
  let member: string | null = null;
  for (const { name, kind } of parsed) {
    if (kind === 'namespace' || kind === 'type') {
      if (member !== null) return symbol;
      owners.push(name);
    } else if (kind === 'method') {
      member = `${name}()`;
    } else if (kind === 'term' || kind === 'meta' || kind === 'macro') {
      member = name;
    }
  }
  const owner = owners.join('.');
  if (member === null) return owner || symbol;
  if (!owner) return member;
  const ownerIsType = parsed.some(({ kind }) => kind === 'type');
  return `${owner}${ownerIsType ? '#' : '.'}${member}`;
}

// Skips scheme, manager, package name and version; a doubled space is an escaped space.
function descriptorPart(symbol: string): string | null {
  let fields = 0;
  let i = 0;
  while (i < symbol.length && fields < 4) {
    if (symbol[i] === ' ') {
      if (symbol[i + 1] === ' ') {
        i += 2;
        continue;
      }
      fields++;
    }
    i++;
  }
  return fields === 4 ? symbol.slice(i) : null;
}

type DescriptorKind =
  | 'namespace'
  | 'type'
  | 'term'
  | 'method'
  | 'meta'
  | 'macro'
  | 'parameter'
  | 'typeParameter';

const DESCRIPTOR_SUFFIXES: Record<string, DescriptorKind> = {
  '/': 'namespace',
  '#': 'type',
  '.': 'term',
  ':': 'meta',
  '!': 'macro',
};

function parseDescriptors(text: string): { name: string; kind: DescriptorKind }[] | null {
  const result: { name: string; kind: DescriptorKind }[] = [];
  let i = 0;
  const readUntil = (close: string): string | null => {
    const end = text.indexOf(close, i);
    if (end < 0) return null;
    const value = text.slice(i, end);
    i = end + 1;
    return value;
  };
  const readName = (): string | null => {
    if (text[i] === '`') {
      let name = '';
      i++;
      while (i < text.length) {
        if (text[i] === '`') {
          if (text[i + 1] !== '`') {
            i++;
            return name;
          }
          i++;
        }
        name += text[i];
        i++;
      }
      return null;
    }
    const start = i;
    while (i < text.length && !'/#.:!([`'.includes(text[i] ?? '')) i++;
    return i > start ? text.slice(start, i) : null;
  };

  while (i < text.length) {
    if (text[i] === '[' || text[i] === '(') {
      const kind = text[i] === '[' ? 'typeParameter' : 'parameter';
      i++;
      const name = readUntil(kind === 'typeParameter' ? ']' : ')');
      if (name === null) return null;
      result.push({ name, kind });
      continue;
    }
    const name = readName();
    if (name === null) return null;
    const suffix = text[i] ?? '';
    i++;
    if (suffix === '(') {
      if (readUntil(')') === null || text[i] !== '.') return null;
      i++;
      result.push({ name, kind: 'method' });
      continue;
    }
    const kind = DESCRIPTOR_SUFFIXES[suffix];
    if (kind === undefined) return null;
    result.push({ name, kind });
  }
  return result;
}

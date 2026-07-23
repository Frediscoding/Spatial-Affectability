/**
 * Spatial Affectability — reading a `.kmz` archive.
 *
 * A KMZ is a ZIP holding a KML document and whatever icons and overlays came
 * with it. It is the format Google Earth, QGIS and every GIS desk export by
 * default, so it is the format a project footprint will actually arrive in.
 *
 * This reads it with no dependencies. `DecompressionStream` does the inflating —
 * it is part of the platform in both the browser and Node — which leaves only
 * the ZIP container to walk, and a ZIP container is a handful of fixed-width
 * records. Pulling in a general-purpose archive library to read one file out of
 * one archive would be a poor trade for a project that currently has zero
 * dependencies.
 *
 * Only what a KMZ needs is supported: stored and deflated entries, no
 * encryption, no ZIP64, no multi-part archives. Anything else is refused
 * explicitly rather than misread.
 */

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/** Largest possible end-of-central-directory record: 22 fixed bytes + a 64 KB comment. */
const MAX_EOCD_SIZE = 22 + 0xffff;

const STORED = 0;
const DEFLATED = 8;

/** Sentinel written in a 32-bit field whose real value lives in a ZIP64 record. */
const ZIP64_MARKER = 0xffffffff;

/**
 * Locates the end-of-central-directory record.
 *
 * It sits at the very end of the archive, except that a ZIP may carry a trailing
 * comment of up to 64 KB, so the signature has to be searched for backwards. The
 * search is bounded: past that distance from the end there is no valid record,
 * and scanning the whole file would let a large corrupt archive take the tab
 * down with it.
 *
 * @param {DataView} view
 * @returns {number} byte offset of the record
 */
function findEndOfCentralDirectory(view) {
  const earliest = Math.max(0, view.byteLength - MAX_EOCD_SIZE);
  for (let offset = view.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  throw new Error('Not a ZIP archive: no end-of-central-directory record found');
}

/**
 * Lists the entries of a ZIP archive, without decompressing anything.
 *
 * Sizes are taken from the central directory rather than from each local header.
 * The two normally agree, but a ZIP written in a single streaming pass leaves the
 * local sizes at zero and puts the real values in a trailing data descriptor.
 * The central directory is authoritative in both cases.
 *
 * @param {Uint8Array} bytes
 * @returns {{name: string, method: number, compressedSize: number,
 *   uncompressedSize: number, headerOffset: number}[]}
 */
export function readZipEntries(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Invalid archive: expected a Uint8Array');
  }
  if (bytes.byteLength < 22) {
    throw new Error('Not a ZIP archive: file is too short');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);

  const count = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (directoryOffset === ZIP64_MARKER || count === 0xffff) {
    throw new Error('ZIP64 archives are not supported: re-export the footprint as a smaller file');
  }

  const decoder = new TextDecoder('utf-8');
  const entries = [];
  let offset = directoryOffset;

  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== CENTRAL_FILE_HEADER) {
      throw new Error('Corrupt ZIP: central directory ends earlier than announced');
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);

    entries.push({
      name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      headerOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Decompresses one entry.
 *
 * The local header has to be read even though the central directory was already
 * parsed: only the local header says how long its own name and extra fields are,
 * and therefore where the compressed bytes actually start. The extra field is
 * routinely a different length in the two places, so the central directory's
 * value cannot be reused here.
 *
 * @param {Uint8Array} bytes - the whole archive
 * @param {{method: number, compressedSize: number, headerOffset: number, name: string}} entry
 * @returns {Promise<Uint8Array>}
 */
export async function readZipEntry(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.headerOffset, true) !== LOCAL_FILE_HEADER) {
    throw new Error(`Corrupt ZIP: no local header for "${entry.name}"`);
  }
  const nameLength = view.getUint16(entry.headerOffset + 26, true);
  const extraLength = view.getUint16(entry.headerOffset + 28, true);
  const start = entry.headerOffset + 30 + nameLength + extraLength;
  const data = bytes.subarray(start, start + entry.compressedSize);

  if (entry.method === STORED) {
    return data;
  }
  if (entry.method !== DEFLATED) {
    throw new Error(
      `Unsupported compression in "${entry.name}": method ${entry.method}. ` +
        'Re-export the footprint without encryption or an unusual compression setting.',
    );
  }

  // 'deflate-raw', not 'deflate': a ZIP stores the deflate stream with no zlib
  // header around it. Using 'deflate' here fails on the very first byte.
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const inflated = source.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(inflated).arrayBuffer());
}

/**
 * Picks the KML document out of an archive's entries.
 *
 * The specification says the document is the first `.kml` at the root of the
 * archive, and names it `doc.kml` by convention; exporters disagree often enough
 * that both have to be tried. `__MACOSX` entries are resource forks a Mac adds
 * when it re-zips an archive, and they shadow the real files under a name that
 * matches every heuristic — they are dropped first.
 *
 * @param {{name: string}[]} entries
 * @returns {{name: string}} the chosen entry
 */
export function findKmlEntry(entries) {
  const candidates = entries.filter(
    (entry) => !entry.name.startsWith('__MACOSX/') && entry.name.toLowerCase().endsWith('.kml'),
  );
  if (candidates.length === 0) {
    throw new Error('No KML document inside the KMZ archive');
  }
  return (
    candidates.find((entry) => entry.name.toLowerCase() === 'doc.kml') ??
    candidates.find((entry) => !entry.name.includes('/')) ??
    candidates[0]
  );
}

/**
 * Reads the KML document out of a KMZ archive.
 *
 * @param {ArrayBuffer|Uint8Array} archive
 * @returns {Promise<string>} the KML source, ready for `parseFootprint`
 */
export async function readKmz(archive) {
  const bytes = archive instanceof Uint8Array ? archive : new Uint8Array(archive);
  const entries = readZipEntries(bytes);
  const target = findKmlEntry(entries);
  const kml = await readZipEntry(bytes, target);
  return new TextDecoder('utf-8').decode(kml);
}

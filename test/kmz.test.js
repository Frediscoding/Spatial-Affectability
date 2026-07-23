import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 } from 'node:zlib';

import { readZipEntries, readZipEntry, findKmlEntry, readKmz } from '../src/model/kmz.js';
import { parseFootprint, rasterizeFootprint } from '../src/model/footprint.js';

/**
 * Builds a ZIP archive in memory.
 *
 * The archives this reader has to cope with are written by GIS software the
 * project has no control over, so the fixture is built here from the format
 * itself rather than committed as an opaque binary. That also lets each test
 * vary exactly one thing — the compression method, the extra field, a corrupted
 * byte — which a fixed fixture could not.
 *
 * @param {{name: string, body: string, store?: boolean, localExtra?: number}[]} files
 * @returns {Uint8Array}
 */
function makeZip(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = encoder.encode(file.body);
    const method = file.store ? 0 : 8;
    const data = file.store ? raw : new Uint8Array(deflateRawSync(raw));
    // An extra field present in the local header only: the two headers are
    // allowed to differ, and the reader must use the local one to find the data.
    const extra = new Uint8Array(file.localExtra ?? 0);

    const local = new Uint8Array(30 + name.length + extra.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc32(raw), true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, extra.length, true);
    local.set(name, 30);
    local.set(extra, 30 + name.length);
    local.set(data, 30 + name.length + extra.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, crc32(raw), true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, raw.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const directorySize = centrals.reduce((total, entry) => total + entry.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, directorySize, true);
  eocdView.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, eocd];
  const archive = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    archive.set(part, at);
    at += part.length;
  }
  return archive;
}

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Polygon>
<outerBoundaryIs><LinearRing><coordinates>
2.35,48.85,0 2.36,48.85,0 2.36,48.86,0 2.35,48.86,0 2.35,48.85,0
</coordinates></LinearRing></outerBoundaryIs>
</Polygon></Placemark></Document></kml>`;

// --- Walking the container ----------------------------------------------

test('the entries of an archive are listed from the central directory', () => {
  const zip = makeZip([
    { name: 'doc.kml', body: KML },
    { name: 'files/icon.png', body: 'not really a png' },
  ]);
  const entries = readZipEntries(zip);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['doc.kml', 'files/icon.png'],
  );
  assert.equal(entries[0].uncompressedSize, new TextEncoder().encode(KML).length);
});

test('something that is not a ZIP is refused', () => {
  assert.throws(() => readZipEntries(new Uint8Array(4)), /too short/);
  assert.throws(() => readZipEntries(new Uint8Array(100)), /no end-of-central-directory/);
  assert.throws(() => readZipEntries('a string'), /expected a Uint8Array/);
});

test('a truncated central directory is reported rather than half-read', () => {
  const zip = makeZip([{ name: 'doc.kml', body: KML }]);
  const view = new DataView(zip.buffer);
  // Claim two entries where the archive holds one.
  view.setUint16(zip.length - 22 + 10, 2, true);
  assert.throws(() => readZipEntries(zip), /Corrupt ZIP/);
});

// --- Getting the bytes out ----------------------------------------------

test('a deflated entry round-trips', async () => {
  const zip = makeZip([{ name: 'doc.kml', body: KML }]);
  const [entry] = readZipEntries(zip);
  assert.equal(entry.method, 8, 'the fixture really is compressed');
  const bytes = await readZipEntry(zip, entry);
  assert.equal(new TextDecoder().decode(bytes), KML);
});

test('a stored entry round-trips too', async () => {
  const zip = makeZip([{ name: 'doc.kml', body: KML, store: true }]);
  const [entry] = readZipEntries(zip);
  assert.equal(entry.method, 0);
  assert.equal(new TextDecoder().decode(await readZipEntry(zip, entry)), KML);
});

test('the data is found through the local header, not the central one', async () => {
  // The local header carries an extra field the central directory does not. A
  // reader that reused the central directory's lengths would start reading 11
  // bytes early and produce garbage.
  const zip = makeZip([{ name: 'doc.kml', body: KML, localExtra: 11 }]);
  const [entry] = readZipEntries(zip);
  assert.equal(new TextDecoder().decode(await readZipEntry(zip, entry)), KML);
});

test('an unsupported compression method is named, not guessed at', async () => {
  const zip = makeZip([{ name: 'doc.kml', body: KML }]);
  const [entry] = readZipEntries(zip);
  await assert.rejects(
    () => readZipEntry(zip, { ...entry, method: 99 }),
    /Unsupported compression/,
  );
});

// --- Choosing the document ----------------------------------------------

test('doc.kml wins over any other KML in the archive', () => {
  const entries = [{ name: 'files/other.kml' }, { name: 'doc.kml' }];
  assert.equal(findKmlEntry(entries).name, 'doc.kml');
});

test('a KML at the root wins when there is no doc.kml', () => {
  const entries = [{ name: 'files/nested.kml' }, { name: 'emprise.kml' }];
  assert.equal(findKmlEntry(entries).name, 'emprise.kml');
});

test('the resource fork a Mac adds does not shadow the real document', () => {
  const entries = [{ name: '__MACOSX/doc.kml' }, { name: 'emprise.kml' }];
  assert.equal(findKmlEntry(entries).name, 'emprise.kml');
});

test('an archive with no KML in it is refused', () => {
  assert.throws(() => findKmlEntry([{ name: 'icon.png' }]), /No KML document/);
});

// --- The whole path -----------------------------------------------------

test('a KMZ becomes a raster the simulation can run on', async () => {
  const zip = makeZip([
    { name: 'doc.kml', body: KML },
    { name: 'files/icon.png', body: 'ignored' },
  ]);
  const kml = await readKmz(zip);
  const polygons = parseFootprint(kml);
  assert.equal(polygons.length, 1);

  // The square is about 0.01° of latitude, so a bit over a kilometre.
  const raster = rasterizeFootprint(polygons, 40);
  assert.ok(raster.households > 100);
  assert.ok(raster.areaHectares > 50 && raster.areaHectares < 130);
  assert.equal(raster.mask.length, raster.height);
});

test('an ArrayBuffer is accepted as well as a Uint8Array', async () => {
  const zip = makeZip([{ name: 'doc.kml', body: KML }]);
  const buffer = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
  assert.equal(await readKmz(buffer), KML);
});

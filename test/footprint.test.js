import test from 'node:test';
import assert from 'node:assert/strict';

import { OUTSIDE, SUPPORTER } from '../src/model/engine.js';
import {
  METRES_PER_DEGREE_LATITUDE,
  MAX_GRID_SIDE,
  MIN_GRID_SIDE,
  metresPerDegreeLongitude,
  pointInRing,
  pointInFootprint,
  boundsOf,
  parseCoordinates,
  parseKml,
  parseGeoJson,
  parseFootprint,
  rasterizeFootprint,
  gridFromMask,
} from '../src/model/footprint.js';

/** A square ring, given its south-west corner and its side in degrees. */
function square(lon, lat, side) {
  return [
    [lon, lat],
    [lon + side, lat],
    [lon + side, lat + side],
    [lon, lat + side],
    [lon, lat],
  ];
}

function kmlDocument(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${inner}</Document></kml>`;
}

function coordinatesOf(ring) {
  return ring.map(([lon, lat]) => `${lon},${lat},0`).join(' ');
}

function kmlPolygon(outer, holes = []) {
  const inner = holes
    .map(
      (hole) =>
        `<innerBoundaryIs><LinearRing><coordinates>${coordinatesOf(hole)}</coordinates></LinearRing></innerBoundaryIs>`,
    )
    .join('');
  return `<Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>${coordinatesOf(
    outer,
  )}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon></Placemark>`;
}

// --- Projection ---------------------------------------------------------

test('a degree of longitude is a full degree at the equator and shrinks towards the poles', () => {
  assert.equal(metresPerDegreeLongitude(0), METRES_PER_DEGREE_LATITUDE);
  // 60° is the textbook case: cos(60°) = 0.5 exactly.
  assert.ok(Math.abs(metresPerDegreeLongitude(60) - METRES_PER_DEGREE_LATITUDE / 2) < 1);
  assert.ok(metresPerDegreeLongitude(-60) > 0, 'the southern hemisphere is not negative');
});

test('a footprint on a pole does not collapse the scale to zero', () => {
  assert.ok(metresPerDegreeLongitude(90) > 0);
  assert.ok(Number.isFinite(1 / metresPerDegreeLongitude(90)));
});

// --- Point in polygon ---------------------------------------------------

test('ray casting places points inside and outside a square', () => {
  const ring = square(0, 0, 1);
  assert.equal(pointInRing([0.5, 0.5], ring), true);
  assert.equal(pointInRing([1.5, 0.5], ring), false);
  assert.equal(pointInRing([0.5, 1.5], ring), false);
  assert.equal(pointInRing([-0.5, 0.5], ring), false);
});

test('a concave outline does not swallow the notch cut out of it', () => {
  // An L shape: the missing quadrant is the top right.
  const ring = [
    [0, 0],
    [2, 0],
    [2, 1],
    [1, 1],
    [1, 2],
    [0, 2],
    [0, 0],
  ];
  assert.equal(pointInRing([0.5, 0.5], ring), true, 'in the corner of the L');
  assert.equal(pointInRing([1.5, 0.5], ring), true, 'in the foot of the L');
  assert.equal(pointInRing([1.5, 1.5], ring), false, 'in the notch, which is not affected land');
});

test('a hole is outside the footprint even though it is inside the outline', () => {
  const polygons = [{ outer: square(0, 0, 4), holes: [square(1, 1, 2)] }];
  assert.equal(pointInFootprint([0.5, 0.5], polygons), true);
  assert.equal(pointInFootprint([2, 2], polygons), false, 'the excluded parcel');
  assert.equal(pointInFootprint([5, 5], polygons), false);
});

test('two disjoint parcels make one footprint', () => {
  const polygons = [
    { outer: square(0, 0, 1), holes: [] },
    { outer: square(10, 10, 1), holes: [] },
  ];
  assert.equal(pointInFootprint([0.5, 0.5], polygons), true);
  assert.equal(pointInFootprint([10.5, 10.5], polygons), true);
  assert.equal(pointInFootprint([5, 5], polygons), false);
});

test('bounds cover every parcel, and an empty footprint is rejected', () => {
  const polygons = [
    { outer: square(0, 0, 1), holes: [] },
    { outer: square(10, 10, 1), holes: [] },
  ];
  assert.deepEqual(boundsOf(polygons), { minLon: 0, minLat: 0, maxLon: 11, maxLat: 11 });
  assert.throws(() => boundsOf([]), /Empty footprint/);
});

// --- Reading KML --------------------------------------------------------

test('coordinates are read as lon,lat and the altitude is dropped', () => {
  assert.deepEqual(parseCoordinates('1,2,300 4,5,600'), [
    [1, 2],
    [4, 5],
  ]);
  assert.deepEqual(parseCoordinates('\n  1,2\n  4,5\n'), [
    [1, 2],
    [4, 5],
  ]);
  assert.throws(() => parseCoordinates('1,north'), /Malformed coordinate/);
});

test('a KML polygon is read with its outer ring', () => {
  const polygons = parseKml(kmlDocument(kmlPolygon(square(0, 0, 1))));
  assert.equal(polygons.length, 1);
  assert.equal(polygons[0].outer.length, 5);
  assert.deepEqual(polygons[0].holes, []);
});

test('a namespace prefix on the elements does not hide the polygon', () => {
  // QGIS and ArcGIS both export prefixed KML often enough for this to matter.
  const prefixed = kmlDocument(kmlPolygon(square(0, 0, 1)))
    .replace(/<(\/?)(Polygon|outerBoundaryIs|LinearRing|coordinates)/g, '<$1kml:$2');
  const polygons = parseKml(prefixed);
  assert.equal(polygons.length, 1);
  assert.equal(polygons[0].outer.length, 5);
});

test('inner boundaries are read as holes', () => {
  const polygons = parseKml(kmlDocument(kmlPolygon(square(0, 0, 4), [square(1, 1, 1), square(2, 2, 1)])));
  assert.equal(polygons[0].holes.length, 2);
  assert.equal(pointInFootprint([1.5, 1.5], polygons), false);
});

test('several placemarks give several parcels of one footprint', () => {
  const kml = kmlDocument(kmlPolygon(square(0, 0, 1)) + kmlPolygon(square(5, 5, 1)));
  assert.equal(parseKml(kml).length, 2);
});

test('a KML with no area in it is refused, not silently read as empty', () => {
  const lineOnly = kmlDocument(
    '<Placemark><LineString><coordinates>0,0 1,1</coordinates></LineString></Placemark>',
  );
  assert.throws(() => parseKml(lineOnly), /must be drawn as an area/);
});

test('a polygon with fewer than three corners encloses nothing and is skipped', () => {
  const degenerate = kmlDocument(kmlPolygon([[0, 0], [1, 1]]));
  assert.throws(() => parseKml(degenerate), /No polygon found/);
});

// --- Reading GeoJSON ----------------------------------------------------

test('a GeoJSON feature collection is read', () => {
  const geojson = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [square(0, 0, 1)] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
    ],
  });
  const polygons = parseGeoJson(geojson);
  assert.equal(polygons.length, 1, 'the point is skipped, not rejected');
  assert.equal(polygons[0].outer.length, 5);
});

test('a MultiPolygon becomes several parcels, holes included', () => {
  const geojson = JSON.stringify({
    type: 'MultiPolygon',
    coordinates: [[square(0, 0, 4), square(1, 1, 2)], [square(10, 10, 1)]],
  });
  const polygons = parseGeoJson(geojson);
  assert.equal(polygons.length, 2);
  assert.equal(polygons[0].holes.length, 1);
  assert.equal(pointInFootprint([2, 2], polygons), false);
});

test('GeoJSON that holds no area is refused', () => {
  assert.throws(() => parseGeoJson('{"type":"Point","coordinates":[0,0]}'), /must be drawn as an area/);
  assert.throws(() => parseGeoJson('not json at all'), /Not valid GeoJSON/);
});

test('the format is decided by the content, not by the file extension', () => {
  assert.equal(parseFootprint(kmlDocument(kmlPolygon(square(0, 0, 1)))).length, 1);
  assert.equal(
    parseFootprint(JSON.stringify({ type: 'Polygon', coordinates: [square(0, 0, 1)] })).length,
    1,
  );
  assert.throws(() => parseFootprint('   '), /Empty footprint file/);
});

// --- Rasterising --------------------------------------------------------

/** 0.001° is about 111.32 m at the equator, so this square is roughly 111 m a side. */
const SMALL_SQUARE = [{ outer: square(0, 0, 0.001), holes: [] }];

test('the grid size is derived from the cell size, not the other way round', () => {
  const raster = rasterizeFootprint(SMALL_SQUARE, 10);
  assert.equal(raster.cellMetres, 10, 'the requested cell size is honoured');
  assert.equal(raster.width, 12, 'ceil(111.32 / 10)');
  assert.equal(raster.height, 12);
});

test('a finer cell size gives more households over the same ground', () => {
  // A square about 1.1 km a side, large enough that neither bound on the grid
  // size interferes with the cell size actually requested.
  const block = [{ outer: square(0, 0, 0.01), holes: [] }];
  const coarse = rasterizeFootprint(block, 20);
  const fine = rasterizeFootprint(block, 10);
  assert.equal(coarse.cellMetres, 20);
  assert.equal(fine.cellMetres, 10);
  assert.ok(fine.households > coarse.households);
  // Halving the cell size quadruples the count, to within one row and column of
  // boundary rounding.
  assert.ok(Math.abs(fine.households / coarse.households - 4) < 1);
});

test('the reported area follows the households, not the bounding box', () => {
  const raster = rasterizeFootprint(SMALL_SQUARE, 10);
  const expected = (raster.households * raster.cellMetres ** 2) / 10000;
  assert.equal(raster.areaHectares, expected);
  // The square is about 111 m a side, so about 1.24 ha.
  assert.ok(raster.areaHectares > 1.1 && raster.areaHectares < 1.3);
});

test('row zero is the north edge, so the footprint is not rendered upside down', () => {
  // A triangle filling the northern half of its bounding box only.
  const triangle = [
    {
      outer: [
        [0, 0.001],
        [0.001, 0.001],
        [0.0005, 0.0004],
        [0, 0.001],
      ],
      holes: [],
    },
  ];
  const { mask, height } = rasterizeFootprint(triangle, 10);
  const inRow = (y) => mask[y].filter(Boolean).length;
  assert.ok(inRow(0) > inRow(height - 1), 'the wide side of the triangle must be at the top');
});

test('a hole in the footprint becomes a hole in the mask', () => {
  const donut = [{ outer: square(0, 0, 0.002), holes: [square(0.0005, 0.0005, 0.001)] }];
  const raster = rasterizeFootprint(donut, 10);
  const solid = rasterizeFootprint([{ outer: square(0, 0, 0.002), holes: [] }], 10);
  assert.ok(raster.households < solid.households);
  const middle = Math.floor(raster.height / 2);
  assert.equal(raster.mask[middle][Math.floor(raster.width / 2)], false, 'the excluded parcel');
});

test('a footprint too large for the requested cell size is coarsened to stay interactive', () => {
  const wide = [{ outer: square(0, 0, 1), holes: [] }]; // about 111 km a side
  const raster = rasterizeFootprint(wide, 100);
  assert.ok(raster.cellMetres > 100, 'the cell size was raised to fit');
  assert.equal(raster.width, MAX_GRID_SIDE);
  assert.equal(raster.height, MAX_GRID_SIDE);
});

test('a footprint too small for the requested cell size is refined instead of collapsing', () => {
  const tiny = [{ outer: square(0, 0, 0.00001), holes: [] }]; // about 1 m a side
  const raster = rasterizeFootprint(tiny, 10);
  assert.ok(raster.cellMetres < 10, 'the cell size was lowered to fit');
  assert.ok(raster.width >= MIN_GRID_SIDE && raster.height >= MIN_GRID_SIDE);
});

test('a corridor keeps the performance ceiling even when that makes it a few cells wide', () => {
  // 5.5 km long, 111 m wide: a road widening. The two bounds conflict here, and
  // the ceiling has to win.
  const corridor = [{ outer: [[0, 0], [0.05, 0], [0.05, 0.001], [0, 0.001], [0, 0]], holes: [] }];
  const raster = rasterizeFootprint(corridor, 50);
  assert.ok(raster.width <= MAX_GRID_SIDE && raster.height <= MAX_GRID_SIDE);
  assert.ok(raster.height < MIN_GRID_SIDE, 'a corridor genuinely has almost no interior');
  assert.ok(raster.households > 0);
});

test('a corridor too long to resolve at all says so instead of returning an empty grid', () => {
  // 111 km long, 111 m wide: a transmission line. At the resolution needed to
  // fit the length, the width is under one cell. There is no honest raster here.
  const line = [{ outer: [[0, 0], [1, 0], [1, 0.001], [0, 0.001], [0, 0]], holes: [] }];
  assert.throws(() => rasterizeFootprint(line, 50), /section/);
});

test('an unusable cell size or a degenerate polygon is rejected loudly', () => {
  assert.throws(() => rasterizeFootprint(SMALL_SQUARE, 0), /Invalid cell size/);
  assert.throws(() => rasterizeFootprint(SMALL_SQUARE, NaN), /Invalid cell size/);
  const line = [{ outer: [[0, 0], [1, 0], [0.5, 0], [0, 0]], holes: [] }];
  assert.throws(() => rasterizeFootprint(line, 10), /encloses no area/);
});

// --- Building the starting grid -----------------------------------------

test('the starting grid holds households inside the footprint and nothing outside it', () => {
  const mask = [
    [false, true],
    [true, true],
  ];
  const grid = gridFromMask(mask, () => SUPPORTER, OUTSIDE);
  assert.deepEqual(grid, [
    [OUTSIDE, SUPPORTER],
    [SUPPORTER, SUPPORTER],
  ]);
});

test('positions are drawn only for households, never for empty ground', () => {
  const mask = [
    [false, true],
    [true, false],
  ];
  const drawn = [];
  gridFromMask(mask, (x, y) => {
    drawn.push([x, y]);
    return SUPPORTER;
  }, OUTSIDE);
  assert.deepEqual(drawn, [
    [1, 0],
    [0, 1],
  ]);
});

/**
 * Spatial Affectability — project footprint.
 *
 * Turns the geographic outline of a project into the grid the simulation runs
 * on. Every function here is pure and free of browser APIs, so the whole
 * pipeline from a KML string to a mask can be tested in Node.
 *
 * The one thing this module does NOT do is read a `.kmz` archive: that needs
 * decompression, and lives in `kmz.js`.
 */

/**
 * Metres per degree of latitude.
 *
 * A sphere of mean Earth radius, not an ellipsoid. The error is about 0.3%
 * between the equator and the poles, which is three metres on a cell of one
 * kilometre. Every household in this model is a token standing for a real one at
 * an unknown address; carrying a full geodesic projection to remove a rounding
 * error that small would be false precision.
 */
export const METRES_PER_DEGREE_LATITUDE = 111320;

/**
 * Bounds on the raster the simulation will run on.
 *
 * The upper bound is a performance limit: every generation touches every cell
 * and the browser redraws the whole grid, so a raster much beyond this stops
 * being interactive. The lower bound protects the model itself — below a few
 * cells a side there is no neighbourhood left to speak of, and the imitation
 * rule has nothing to work with.
 */
export const MAX_GRID_SIDE = 200;
export const MIN_GRID_SIDE = 8;

/**
 * Longitude scale at a given latitude.
 *
 * Meridians converge towards the poles, so a degree of longitude is shorter than
 * a degree of latitude everywhere except the equator. Ignoring this would
 * stretch every footprint east-west, by a factor of two at 60° and more further
 * north — the polygon would still look like a polygon, just the wrong one, and
 * the cells would no longer be square on the ground.
 *
 * @param {number} latitude - in degrees
 * @returns {number} metres per degree of longitude
 */
export function metresPerDegreeLongitude(latitude) {
  const scale = Math.cos((latitude * Math.PI) / 180);
  // Guard against a footprint sitting exactly on a pole, where the scale
  // collapses to zero and every derived size becomes infinite.
  return METRES_PER_DEGREE_LATITUDE * Math.max(scale, 1e-6);
}

/**
 * Whether a point falls inside a ring, by ray casting.
 *
 * Counts how many edges a ray cast east from the point crosses: odd means
 * inside. The ring does not need to be explicitly closed, and its winding
 * direction does not matter.
 *
 * @param {[number, number]} point - [longitude, latitude]
 * @param {[number, number][]} ring
 * @returns {boolean}
 */
export function pointInRing(point, ring) {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // Strictly-greater on one side and not the other: a vertex exactly at the
    // ray's latitude is counted once, not twice.
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Whether a point falls inside the footprint, holes taken into account.
 *
 * A hole is not a modelling curiosity: a footprint routinely excludes a parcel
 * that is not being acquired — a cemetery, a school, a compound already
 * resettled. Land inside a hole is outside the affected area, and the households
 * around it border empty ground on that side.
 *
 * @param {[number, number]} point
 * @param {{outer: [number, number][], holes: [number, number][][]}[]} polygons
 * @returns {boolean}
 */
export function pointInFootprint(point, polygons) {
  for (const polygon of polygons) {
    if (!pointInRing(point, polygon.outer)) {
      continue;
    }
    if (polygon.holes.some((hole) => pointInRing(point, hole))) {
      continue; // in the outline but in a hole in it
    }
    return true;
  }
  return false;
}

/**
 * Bounding box of a set of polygons.
 *
 * @param {{outer: [number, number][]}[]} polygons
 * @returns {{minLon: number, minLat: number, maxLon: number, maxLat: number}}
 */
export function boundsOf(polygons) {
  if (!Array.isArray(polygons) || polygons.length === 0) {
    throw new Error('Empty footprint: no polygon to take the bounds of');
  }
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const polygon of polygons) {
    for (const [lon, lat] of polygon.outer) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) {
    throw new Error('Empty footprint: no usable coordinates');
  }
  return { minLon, minLat, maxLon, maxLat };
}

// --- Reading coordinates ------------------------------------------------

/** Matches an element by local name, whatever XML namespace prefix it carries. */
function tagPattern(name, flags) {
  return new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, flags);
}

/**
 * Reads a KML `<coordinates>` body into a ring.
 *
 * KML writes tuples as `lon,lat[,altitude]`, separated by any whitespace.
 * Altitude is read and discarded: this model is strictly planimetric.
 *
 * @param {string} text
 * @returns {[number, number][]}
 */
export function parseCoordinates(text) {
  const ring = [];
  for (const tuple of text.trim().split(/\s+/)) {
    if (tuple === '') {
      continue;
    }
    const [lon, lat] = tuple.split(',').map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`Malformed coordinate in KML: "${tuple}"`);
    }
    ring.push([lon, lat]);
  }
  return ring;
}

/**
 * Extracts every polygon from a KML document.
 *
 * This reads the document with regular expressions rather than a DOM parser, for
 * one reason: `DOMParser` does not exist in Node, and pushing KML parsing into
 * the browser would put the least trustworthy input in the codebase — a file
 * from a user's GIS export — in the one place that cannot be covered by the test
 * suite. The grammar being matched is narrow and fully bounded: the coordinate
 * bodies of the boundary rings of `<Polygon>` elements. Anything else in the
 * document, including styles, folders and nested `<MultiGeometry>`, is ignored
 * rather than interpreted.
 *
 * Every polygon found is kept, wherever it sits in the document tree. A
 * footprint made of several disjoint parcels is a single footprint here — which
 * is what it is on the ground.
 *
 * @param {string} text
 * @returns {{outer: [number, number][], holes: [number, number][][]}[]}
 */
export function parseKml(text) {
  const polygons = [];
  const blocks = text.match(tagPattern('Polygon', 'gi')) ?? [];

  for (const block of blocks) {
    const outerBlock = block.match(tagPattern('outerBoundaryIs', 'i'));
    if (!outerBlock) {
      continue; // a polygon with no outer boundary is not a polygon
    }
    const outerCoords = outerBlock[1].match(tagPattern('coordinates', 'i'));
    if (!outerCoords) {
      continue;
    }
    const outer = parseCoordinates(outerCoords[1]);
    if (outer.length < 3) {
      continue; // degenerate: fewer than three corners encloses no area
    }

    const holes = [];
    for (const innerBlock of block.match(tagPattern('innerBoundaryIs', 'gi')) ?? []) {
      const innerCoords = innerBlock.match(tagPattern('coordinates', 'i'));
      if (!innerCoords) {
        continue;
      }
      const hole = parseCoordinates(innerCoords[1]);
      if (hole.length >= 3) {
        holes.push(hole);
      }
    }
    polygons.push({ outer, holes });
  }

  if (polygons.length === 0) {
    throw new Error('No polygon found in the KML: the footprint must be drawn as an area');
  }
  return polygons;
}

/** Turns one GeoJSON ring array into our polygon shape. */
function ringsToPolygon(rings) {
  const [outer, ...holes] = rings;
  return {
    outer: outer.map(([lon, lat]) => [Number(lon), Number(lat)]),
    holes: holes.filter((hole) => hole.length >= 3).map((hole) => hole.map(([lon, lat]) => [Number(lon), Number(lat)])),
  };
}

/**
 * Extracts every polygon from a GeoJSON document.
 *
 * Accepted because it costs almost nothing once the rest of the pipeline exists,
 * and because a GIS team is as likely to hand over a `.geojson` as a `.kmz`.
 * `Polygon` and `MultiPolygon` are read, in a bare geometry, a `Feature` or a
 * `FeatureCollection`; other geometry types are skipped rather than rejected, so
 * a file mixing the footprint with survey points still loads.
 *
 * @param {string} text
 * @returns {{outer: [number, number][], holes: [number, number][][]}[]}
 */
export function parseGeoJson(text) {
  let root;
  try {
    root = JSON.parse(text);
  } catch (cause) {
    throw new Error(`Not valid GeoJSON: ${cause.message}`);
  }

  const polygons = [];
  const visit = (node) => {
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node.features)) {
      node.features.forEach(visit);
    }
    if (node.geometry) {
      visit(node.geometry);
    }
    if (Array.isArray(node.geometries)) {
      node.geometries.forEach(visit);
    }
    if (node.type === 'Polygon' && Array.isArray(node.coordinates)) {
      polygons.push(ringsToPolygon(node.coordinates));
    }
    if (node.type === 'MultiPolygon' && Array.isArray(node.coordinates)) {
      node.coordinates.forEach((rings) => polygons.push(ringsToPolygon(rings)));
    }
  };
  visit(root);

  const usable = polygons.filter((polygon) => polygon.outer.length >= 3);
  if (usable.length === 0) {
    throw new Error('No polygon found in the GeoJSON: the footprint must be drawn as an area');
  }
  return usable;
}

/**
 * Reads a footprint from KML or GeoJSON, whichever it turns out to be.
 *
 * The format is decided by the content, not by the file extension. Extensions
 * are unreliable — a `.kml` renamed from a `.json`, a file arriving from a
 * download with no extension at all — and the first non-blank character
 * separates the two formats unambiguously.
 *
 * @param {string} text
 * @returns {{outer: [number, number][], holes: [number, number][][]}[]}
 */
export function parseFootprint(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Empty footprint file');
  }
  const first = text.trimStart()[0];
  return first === '{' || first === '[' ? parseGeoJson(text) : parseKml(text);
}

// --- Rasterising --------------------------------------------------------

/**
 * Turns a footprint into the mask the simulation runs on.
 *
 * The user chooses the size of a cell **in metres**, not the size of the grid.
 * A cell then stands for a fixed area of ground whatever the project, so a
 * household means the same thing across two runs and two footprints can be
 * compared. Deriving the grid from the cell size rather than the reverse is the
 * whole point: with a fixed 60x60 grid stretched over the bounding box, a cell
 * would mean twenty metres on one project and two kilometres on another, and
 * every number on screen would quietly change meaning between runs.
 *
 * A cell is inside the footprint when **its centre** is. Sampling the centre is
 * the standard convention and it is unbiased: a cell straddling the boundary is
 * included if most of it is inside. The alternative, including any cell the
 * boundary touches, would inflate every footprint by half a cell all the way
 * round — a systematic outward bias on exactly the perimeter this model is built
 * to measure.
 *
 * The requested cell size is honoured unless it would produce a grid outside
 * [`MIN_GRID_SIDE`, `MAX_GRID_SIDE`], in which case it is scaled to fit and the
 * size actually used is reported back. A silently unusable grid would be worse
 * than a rounded one.
 *
 * @param {{outer: [number, number][], holes: [number, number][][]}[]} polygons
 * @param {number} cellMetres - requested size of one cell, in metres
 * @returns {{mask: boolean[][], width: number, height: number, cellMetres: number,
 *   households: number, areaHectares: number, bounds: object}}
 */
export function rasterizeFootprint(polygons, cellMetres) {
  if (!Number.isFinite(cellMetres) || cellMetres <= 0) {
    throw new Error(`Invalid cell size: expected a positive number of metres, got ${cellMetres}`);
  }
  const bounds = boundsOf(polygons);
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const lonScale = metresPerDegreeLongitude(midLat);

  const widthMetres = (bounds.maxLon - bounds.minLon) * lonScale;
  const heightMetres = (bounds.maxLat - bounds.minLat) * METRES_PER_DEGREE_LATITUDE;
  if (!(widthMetres > 0) || !(heightMetres > 0)) {
    throw new Error('Degenerate footprint: the polygon encloses no area');
  }

  // Fit the requested cell size to the allowed range of grid sizes, keeping the
  // aspect ratio of the footprint intact by scaling both axes by the same factor.
  const longestSide = Math.max(widthMetres, heightMetres);
  const shortestSide = Math.min(widthMetres, heightMetres);
  let size = cellMetres;

  // Too coarse to resolve the narrow dimension: refine it.
  if (shortestSide / size < MIN_GRID_SIDE) {
    size = shortestSide / MIN_GRID_SIDE;
  }
  // The performance ceiling is applied last so that it always wins. The two
  // bounds genuinely conflict for a footprint longer than 25 times its width — a
  // road or a transmission line corridor, which is a common enough shape. There
  // the corridor comes out only a few cells across, and that is the honest
  // answer: such a project has almost no interior, every household is a boundary
  // household, and the model should say so rather than fake a wider strip.
  if (longestSide / size > MAX_GRID_SIDE) {
    size = longestSide / MAX_GRID_SIDE;
  }

  const width = Math.max(Math.ceil(widthMetres / size), 1);
  const height = Math.max(Math.ceil(heightMetres / size), 1);
  const degPerCellX = size / lonScale;
  const degPerCellY = size / METRES_PER_DEGREE_LATITUDE;

  const mask = [];
  let households = 0;
  for (let y = 0; y < height; y += 1) {
    const row = [];
    // Row 0 is the north edge: on screen, y grows downwards while latitude grows
    // upwards. Getting this backwards would render every footprint mirrored.
    const lat = bounds.maxLat - (y + 0.5) * degPerCellY;
    for (let x = 0; x < width; x += 1) {
      const lon = bounds.minLon + (x + 0.5) * degPerCellX;
      const inside = pointInFootprint([lon, lat], polygons);
      if (inside) {
        households += 1;
      }
      row.push(inside);
    }
    mask.push(row);
  }

  if (households === 0) {
    // Reached when the footprint is so much longer than it is wide that the cell
    // size needed to fit its length is larger than its width. A linear project
    // is a different modelling problem, and saying so is more useful than
    // returning a grid with nobody in it.
    throw new Error(
      'This footprint is far longer than it is wide, and resolves to less than one cell ' +
        'across. Import one section of the corridor at a time.',
    );
  }

  return {
    mask,
    width,
    height,
    cellMetres: size,
    households,
    areaHectares: (households * size * size) / 10000,
    bounds,
  };
}

/**
 * Builds a starting grid from a mask.
 *
 * `pickState` is called once per household, and only for households: land
 * outside the footprint is never offered a position. Passing it in rather than
 * drawing here keeps this function pure and lets a test lay out a known grid.
 *
 * @param {boolean[][]} mask
 * @param {(x: number, y: number) => string} pickState
 * @param {string} outside - the value to fill land outside the footprint with
 * @returns {string[][]}
 */
export function gridFromMask(mask, pickState, outside) {
  return mask.map((row, y) => row.map((inside, x) => (inside ? pickState(x, y) : outside)));
}

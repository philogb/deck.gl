// Copyright (c) 2015 - 2017 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// Handles tesselation of polygons with holes
// - 2D surfaces
// - 2D outlines
// - 3D surfaces (top and sides only)
// - 3D wireframes (not yet)
import * as Polygon from './polygon';
import earcut from 'earcut';
import {experimental} from '../../core';
const {get, count, flattenVertices, fillArray} = experimental;

// Maybe deck.gl or luma.gl needs to export this
function getPickingColor(index) {
  return [
    (index + 1) % 256,
    Math.floor((index + 1) / 256) % 256,
    Math.floor((index + 1) / 256 / 256) % 256
  ];
}

function parseColor(color) {
  if (!Array.isArray(color)) {
    color = [get(color, 0), get(color, 1), get(color, 2), get(color, 3)];
  }
  color[3] = Number.isFinite(color[3]) ? color[3] : 255;
  return color;
}

const DEFAULT_COLOR = [0, 0, 0, 255]; // Black

// This class is set up to allow querying one attribute at a time
// the way the AttributeManager expects it
export class PolygonTesselator {
  constructor(polygons) {
    // Normalize all polygons
    polygons = polygons.map(polygon => Polygon.normalize(polygon));

    // Count all polygon vertices
    const pointCount = getPointCount(polygons);

    this.polygons = polygons;
    this.pointCount = pointCount;

    this.attributes = {
      pickingColors: calculatePickingColors({polygons, pointCount})
    };
  }

  updatePositions({fp64, extruded, getHeight}) {
    const {attributes, polygons, pointCount} = this;

    attributes.positions = attributes.positions || new Float32Array(pointCount * 3);
    attributes.nextPositions = attributes.nextPositions || new Float32Array(pointCount * 3);

    if (fp64) {
      // We only need x, y component
      attributes.positions64xyLow = attributes.positions64xyLow ||
        new Float32Array(pointCount * 2);
      attributes.nextPositions64xyLow = attributes.nextPositions64xyLow ||
        new Float32Array(pointCount * 2);
    }

    updatePositions(attributes, {polygons, getHeight, extruded, fp64});
  }

  indices() {
    const {polygons, indexCount} = this;
    return calculateIndices({polygons, indexCount});
  }

  vertexPositions() {
    const {pointCount} = this;
    return new Float32Array(pointCount * 2);
  }

  positions() {
    return this.attributes.positions;
  }
  positions64xyLow() {
    return this.attributes.positions64xyLow;
  }

  nextPositions() {
    return this.attributes.nextPositions;
  }
  nextPositions64xyLow() {
    return this.attributes.nextPositions64xyLow;
  }

  colors({getColor = x => DEFAULT_COLOR} = {}) {
    const {attributes, polygons, pointCount} = this;
    attributes.colors = attributes.colors || new Uint8ClampedArray(pointCount * 4);
    return updateColors(attributes, {polygons, getColor});
  }

  pickingColors() {
    return this.attributes.pickingColors;
  }

  // getAttribute({size, accessor}) {
  //   const {polygons, pointCount} = this;
  //   return calculateAttribute({polygons, pointCount, size, accessor});
  // }
}

// Count number of points in a list of complex polygons
function getPointCount(polygons) {
  return polygons.reduce((points, polygon) => points + Polygon.getVertexCount(polygon), 0);
}

// COunt number of triangles in a list of complex polygons
function getTriangleCount(polygons) {
  return polygons.reduce((triangles, polygon) => triangles + Polygon.getTriangleCount(polygon), 0);
}

// Returns the offsets of each complex polygon in the combined array of all polygons
function getPolygonOffsets(polygons) {
  const offsets = new Array(count(polygons) + 1);
  offsets[0] = 0;
  let offset = 0;
  polygons.forEach((polygon, i) => {
    offset += Polygon.getVertexCount(polygon);
    offsets[i + 1] = offset;
  });
  return offsets;
}

// Returns the offset of each hole polygon in the flattened array for that polygon
function getHoleIndices(complexPolygon) {
  let holeIndices = null;
  if (count(complexPolygon) > 1) {
    let polygonStartIndex = 0;
    holeIndices = [];
    complexPolygon.forEach(polygon => {
      polygonStartIndex += count(polygon);
      holeIndices.push(polygonStartIndex);
    });
    // Last element points to end of the flat array, remove it
    holeIndices.pop();
  }
  return holeIndices;
}

function calculateIndices({polygons, IndexType = Uint32Array}) {
  // Calculate length of index array (3 * number of triangles)
  const indexCount = 3 * getTriangleCount(polygons);
  const offsets = getPolygonOffsets(polygons);

  // Allocate the attribute
  // TODO it's not the index count but the vertex count that must be checked
  if (IndexType === Uint16Array && indexCount > 65535) {
    throw new Error('Vertex count exceeds browser\'s limit');
  }
  const attribute = new IndexType(indexCount);

  // 1. get triangulated indices for the internal areas
  // 2. offset them by the number of indices in previous polygons
  let i = 0;
  polygons.forEach((polygon, polygonIndex) => {
    for (const index of calculateSurfaceIndices(polygon)) {
      attribute[i++] = index + offsets[polygonIndex];
    }
  });

  return attribute;
}

/*
 * Get vertex indices for drawing complexPolygon mesh
 * @private
 * @param {[Number,Number,Number][][]} complexPolygon
 * @returns {[Number]} indices
 */
function calculateSurfaceIndices(complexPolygon) {
  // Prepare an array of hole indices as expected by earcut
  const holeIndices = getHoleIndices(complexPolygon);
  // Flatten the polygon as expected by earcut
  const verts = flattenVertices2(complexPolygon);
  // Let earcut triangulate the polygon
  return earcut(verts, holeIndices, 3);
}

// TODO - refactor
function isContainer(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value) ||
    value !== null && typeof value === 'object';
}

// TODO - refactor, this file should not need a separate flatten func
// Flattens nested array of vertices, padding third coordinate as needed
export function flattenVertices2(nestedArray, {result = [], dimensions = 3} = {}) {
  let index = -1;
  let vertexLength = 0;
  const length = count(nestedArray);
  while (++index < length) {
    const value = get(nestedArray, index);
    if (isContainer(value)) {
      flattenVertices(value, {result, dimensions});
    } else {
      if (vertexLength < dimensions) { // eslint-disable-line
        result.push(value);
        vertexLength++;
      }
    }
  }
  // Add a third coordinate if needed
  if (vertexLength > 0 && vertexLength < dimensions) {
    result.push(0);
  }
  return result;
}

function updatePositions(
  {positions, positions64xyLow, nextPositions, nextPositions64xyLow},
  {polygons, getHeight, extruded, fp64}
) {
  // Flatten out all the vertices of all the sub subPolygons
  let i = 0;
  let j = 0;
  let nextI = 0;
  let nextJ = 0;
  let startVertex = null;

  const popStartVertex = () => {
    if (startVertex && extruded) {
      nextPositions[nextI++] = startVertex.x;
      nextPositions[nextI++] = startVertex.y;
      nextPositions[nextI++] = startVertex.z;
      if (fp64) {
        nextPositions64xyLow[nextJ++] = startVertex.xLow;
        nextPositions64xyLow[nextJ++] = startVertex.yLow;
      }
    }
    startVertex = null;
  };

  polygons.forEach((polygon, polygonIndex) => {
    const height = extruded ? getHeight(polygonIndex) : 0;
    forEachVertex(polygon, (vertex, vertexIndex) => { // eslint-disable-line
      const x = get(vertex, 0);
      const y = get(vertex, 1);
      const z = (get(vertex, 2) || 0) + height;
      let xLow;
      let yLow;

      positions[i++] = x;
      positions[i++] = y;
      positions[i++] = z;
      if (fp64) {
        xLow = x - Math.fround(x);
        yLow = y - Math.fround(y);
        positions64xyLow[j++] = xLow;
        positions64xyLow[j++] = yLow;
      }
      if (extruded && vertexIndex > 0) {
        nextPositions[nextI++] = x;
        nextPositions[nextI++] = y;
        nextPositions[nextI++] = z;
        if (fp64) {
          nextPositions64xyLow[nextJ++] = xLow;
          nextPositions64xyLow[nextJ++] = yLow;
        }
      }
      if (vertexIndex === 0) {
        popStartVertex();
        startVertex = {x, y, z, xLow, yLow};
      }
    });
  });
  popStartVertex();
}

function updateColors({colors}, {polygons, getColor}) {
  let i = 0;
  polygons.forEach((complexPolygon, polygonIndex) => {
    // Calculate polygon color
    let color = getColor(polygonIndex);
    color = parseColor(color);

    const vertexCount = Polygon.getVertexCount(complexPolygon);
    fillArray({target: colors, source: color, start: i, count: vertexCount});
    i += color.length * vertexCount;
  });
  return colors;
}

function calculatePickingColors({polygons, pointCount}) {
  const attribute = new Uint8ClampedArray(pointCount * 3);
  let i = 0;
  polygons.forEach((complexPolygon, polygonIndex) => {
    const color = getPickingColor(polygonIndex);
    const vertexCount = Polygon.getVertexCount(complexPolygon);
    fillArray({target: attribute, source: color, start: i, count: vertexCount});
    i += color.length * vertexCount;
  });
  return attribute;
}

function forEachVertex(polygon, visitor) {
  if (Polygon.isSimple(polygon)) {
    polygon.forEach(visitor);
    return;
  }

  polygon.forEach(simplePolygon => {
    simplePolygon.forEach(visitor);
  });
}

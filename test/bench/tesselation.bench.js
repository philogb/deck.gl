import * as data from 'deck.gl/test/data';

import {PolygonTesselator} from 'deck.gl/core-layers/solid-polygon-layer/polygon-tesselator';

const polygons = data.choropleths.features.map(f => f.geometry.coordinates);

function testTesselator(tesselator, {getHeight, extruded, fp64}) {
  tesselator.updatePositions({getHeight, extruded, fp64});

  return {
    indices: tesselator.indices(),
    positions: tesselator.positions(),
    nextPositions: tesselator.positions(),
    vertexPositions: tesselator.vertexPositions(),
    colors: tesselator.colors(),
    pickingColors: tesselator.pickingColors()
  };
}

export default function tesselationBench(suite) {
  return suite

    .group('TESSELATOR')
    .add('polygonTesselator#flat', () => {
      const tesselator = new PolygonTesselator(polygons);
      testTesselator(tesselator, {});
    })
    .add('polygonTesselator#extruded', () => {
      const tesselator = new PolygonTesselator(polygons);
      testTesselator(tesselator, {getHeight: x => x, extruded: true});
    })
    .add('polygonTesselator#wireframe', () => {
      const tesselator = new PolygonTesselator(polygons);
      testTesselator(tesselator, {getHeight: x => x, extruded: true});
    })

    .add('polygonTesselator#flat - fp64', () => {
      const tesselator = new PolygonTesselator(polygons);
      testTesselator(tesselator, {fp64: true});
    })
    .add('polygonTesselator#extruded - fp64', () => {
      const tesselator = new PolygonTesselator(polygons);
      testTesselator(tesselator, {getHeight: x => x, extruded: true, fp64: true});
    })
    .add('polygonTesselator#wireframe - fp64', () => {
      const tesselator = new PolygonTesselator(polygons);
      testTesselator(tesselator, {getHeight: x => x, extruded: true, fp64: true});
    })

    ;
}

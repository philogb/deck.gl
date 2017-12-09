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

import {COORDINATE_SYSTEM, Layer, experimental} from '../../core';
const {enable64bitSupport, get} = experimental;
import {GL, Model, Geometry} from 'luma.gl';
import {compareProps} from '../../core/lib/props';

// Polygon geometry generation is managed by the polygon tesselator
import {PolygonTesselator} from './polygon-tesselator';

import vs from './solid-polygon-layer-vertex.glsl';
import vs64 from './solid-polygon-layer-vertex-64.glsl';
import fs from './solid-polygon-layer-fragment.glsl';

const defaultProps = {
  // Whether to extrude
  extruded: false,
  // Whether to draw a GL.LINES wireframe of the polygon
  wireframe: false,
  fp64: false,

  // elevation multiplier
  elevationScale: 1,

  // Accessor for polygon geometry
  getPolygon: f => get(f, 'polygon') || get(f, 'geometry.coordinates'),
  // Accessor for extrusion height
  getElevation: f => get(f, 'elevation') || get(f, 'properties.height') || 0,
  // Accessor for color
  getColor: f => get(f, 'color') || get(f, 'properties.color'),

  // Optional settings for 'lighting' shader module
  lightSettings: {
    lightsPosition: [-122.45, 37.75, 8000, -122.0, 38.00, 5000],
    ambientRatio: 0.05,
    diffuseRatio: 0.6,
    specularRatio: 0.8,
    lightsStrength: [2.0, 0.0, 0.0, 0.0],
    numberOfLights: 2
  }
};

// Side model attributes
const SIDE_FILL_POSITIONS = new Float32Array([
  // top left corner
  0, 1,
  // bottom left corner
  0, 0,
  // top right corner
  1, 1,
  // bottom right corner
  1, 0
]);
const SIDE_WIRE_POSITIONS = new Float32Array([
  // top right corner
  1, 1,
  // top left corner
  0, 1,
  // bottom left corner
  0, 0,
  // bottom right corner
  1, 0
]);

export default class SolidPolygonLayer extends Layer {
  getShaders() {
    return enable64bitSupport(this.props) ?
      {vs: vs64, fs, modules: ['project64', 'lighting', 'picking']} :
      {vs, fs, modules: ['lighting', 'picking']}; // 'project' module added by default.
  }

  initializeState() {
    const {gl} = this.context;
    this.setState({
      models: this._getModels(gl),
      numInstances: 0,
      IndexType: gl.getExtension('OES_element_index_uint') ? Uint32Array : Uint16Array
    });

    const {attributeManager} = this.state;
    const noAlloc = true;
    /* eslint-disable max-len */
    attributeManager.add({
      indices: {size: 1, isIndexed: true, update: this.calculateIndices, noAlloc},
      vertexPositions: {size: 2, update: this.calculateVertexPositions, noAlloc},
      positions: {size: 3, isInstanced: true, accessor: ['getElevation', 'extruded', 'fp64'], update: this.calculatePositions, noAlloc},
      nextPositions: {size: 3, isInstanced: true, accessor: ['getElevation', 'extruded', 'fp64'], update: this.calculateNextPositions, noAlloc},
      colors: {size: 4, isInstanced: true, type: GL.UNSIGNED_BYTE, accessor: 'getColor', update: this.calculateColors, noAlloc},
      pickingColors: {size: 3, isInstanced: true, type: GL.UNSIGNED_BYTE, update: this.calculatePickingColors, noAlloc}
    });
    /* eslint-enable max-len */
  }

  updateAttribute({props, oldProps, changeFlags}) {
    if (props.fp64 !== oldProps.fp64) {
      const {attributeManager} = this.state;
      attributeManager.invalidateAll();

      if (props.fp64 && props.coordinateSystem === COORDINATE_SYSTEM.LNGLAT) {
        /* eslint-disable max-len */
        attributeManager.add({
          positions64xyLow: {size: 2, isInstanced: true, accessor: 'fp64', update: this.calculatePositionsLow},
          nextPositions64xyLow: {size: 2, isInstanced: true, accessor: 'fp64', update: this.calculateNextPositionsLow}
        });
        /* eslint-enable max-len */
      } else {
        attributeManager.remove([
          'positions64xyLow',
          'nextPositions64xyLow'
        ]);
      }
    }
  }

  draw({uniforms}) {
    const {extruded, lightSettings, elevationScale} = this.props;
    const {viewport} = this.context;

    const renderUniforms = Object.assign({}, uniforms, {
      extruded: extruded ? 1.0 : 0.0,
      elevationScale,
      pixelsPerUnit: viewport.getDistanceScales().pixelsPerDegree
    },
    lightSettings);

    this.state.models.forEach(model => {
      model.render(renderUniforms);
    });
  }

  updateState(updateParams) {
    super.updateState(updateParams);

    this.updateGeometry(updateParams);
    const {props, oldProps} = updateParams;

    const regenerateModels = props.fp64 !== oldProps.fp64 ||
      props.extruded !== oldProps.extruded ||
      props.wireframe !== oldProps.wireframe;

    if (regenerateModels) {
      this.setState({
        // Set a flag to set attributes to new models
        modelsChanged: true,
        models: this._getModels(this.context.gl)
      });
    }

    if (props.extruded !== !oldProps.extruded) {
      this.state.attributeManager.invalidate('extruded');
    }
    if (props.fp64 !== !oldProps.fp64) {
      this.state.attributeManager.invalidate('fp64');
    }
  }

  updateGeometry({props, oldProps, changeFlags}) {
    const geometryConfigChanged = changeFlags.dataChanged ||
      (changeFlags.updateTriggersChanged && (
        changeFlags.updateTriggersChanged.all ||
        changeFlags.updateTriggersChanged.getPolygon));

    // check if updateTriggers.getElevation has been triggered
    const getElevationTriggered = changeFlags.updateTriggersChanged &&
      compareProps({
        oldProps: oldProps.updateTriggers.getElevation || {},
        newProps: props.updateTriggers.getElevation || {},
        triggerName: 'getElevation'
      });

    const shouldUpdatePositions = geometryConfigChanged ||
      getElevationTriggered ||
      props.extruded !== oldProps.extruded ||
      props.fp64 !== oldProps.fp64;

    // When the geometry config  or the data is changed,
    // tessellator needs to be invoked
    if (geometryConfigChanged) {
      // TODO - avoid creating a temporary array here: let the tesselator iterate
      const polygons = props.data.map(props.getPolygon);

      this.setState({
        polygonTesselator: new PolygonTesselator(polygons)
      });

      this.state.attributeManager.invalidateAll();
    }

    if (shouldUpdatePositions) {
      this.state.polygonTesselator.updatePositions({
        fp64: props.fp64,
        extruded: props.extruded,
        getHeight: polygonIndex => props.getElevation(props.data[polygonIndex])
      });
    }
  }

  updateAttributes(props) {
    const {attributeManager, modelsChanged} = this.state;

    // Figure out data length
    attributeManager.update({
      data: props.data,
      numInstances: 0,
      props,
      buffers: props,
      context: this,
      // Don't worry about non-attribute props
      ignoreUnknownAttributes: true
    });

    if (modelsChanged) {
      this._updateAttributes(attributeManager.attributes);
      // clear the flag
      this.setState({modelsChanged: false});
    } else {
      const changedAttributes = attributeManager.getChangedAttributes({clearChangedFlags: true});
      this._updateAttributes(changedAttributes);
    }
  }

  _updateAttributes(attributes) {
    this.state.models.forEach(model => {
      const {isInstanced} = model;

      if (isInstanced) {
        model.setInstanceCount(this.state.numInstances);
      } else {
        model.setVertexCount(this.state.numVertex);
      }

      const newAttributes = {};
      for (const attributeName in attributes) {
        const attribute = attributes[attributeName];
        if (attribute.isInstanced || !isInstanced) {
          newAttributes[attributeName] = {
            isIndexed: attribute.isIndexed,
            instanced: isInstanced,
            size: attribute.size,
            value: attribute.value
          };
        }
      }
      model.setAttributes(newAttributes);
    });
  }

  _getModels(gl) {
    const {id, extruded, wireframe} = this.props;

    return [
      !wireframe && new Model(gl, Object.assign({}, this.getShaders(), {
        id: `${id}-top`,
        geometry: new Geometry({
          drawMode: GL.TRIANGLES,
          attributes: {}
        }),
        uniforms: {
          isSideVertex: 0
        },
        vertexCount: 0,
        isIndexed: true,
        shaderCache: this.context.shaderCache
      })),

      extruded && new Model(gl, Object.assign({}, this.getShaders(), {
        id: `${id}-side`,
        geometry: new Geometry({
          drawMode: wireframe ? GL.LINE_STRIP : GL.TRIANGLE_STRIP,
          vertexCount: 4,
          attributes: {
            vertexPositions: {size: 2, value: wireframe ? SIDE_WIRE_POSITIONS : SIDE_FILL_POSITIONS}
          }
        }),
        uniforms: {
          isSideVertex: 1
        },
        isInstanced: true,
        shaderCache: this.context.shaderCache
      }))
    ].filter(Boolean);

  }

  calculateIndices(attribute) {
    attribute.value = this.state.polygonTesselator.indices();
    attribute.target = GL.ELEMENT_ARRAY_BUFFER;
    const numVertex = attribute.value.length / attribute.size;
    this.setState({numVertex});
  }

  calculateVertexPositions(attribute) {
    attribute.value = this.state.polygonTesselator.vertexPositions();
    const numInstances = attribute.value.length / attribute.size;
    this.setState({numInstances});
  }

  calculatePositions(attribute) {
    attribute.value = this.state.polygonTesselator.positions();
  }
  calculatePositionsLow(attribute) {
    attribute.value = this.state.polygonTesselator.positions64xyLow();
  }

  calculateNextPositions(attribute) {
    attribute.value = this.state.polygonTesselator.nextPositions();
  }
  calculateNextPositionsLow(attribute) {
    attribute.value = this.state.polygonTesselator.nextPositions64xyLow();
  }

  calculateColors(attribute) {
    attribute.value = this.state.polygonTesselator.colors({
      getColor: polygonIndex => this.props.getColor(this.props.data[polygonIndex])
    });
  }

  // Override the default picking colors calculation
  calculatePickingColors(attribute) {
    attribute.value = this.state.polygonTesselator.pickingColors();
  }
}

SolidPolygonLayer.layerName = 'SolidPolygonLayer';
SolidPolygonLayer.defaultProps = defaultProps;

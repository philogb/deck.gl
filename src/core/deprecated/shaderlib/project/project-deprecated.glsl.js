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

export default `\
// Backwards compatibility
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 projectionPixelsPerUnit;
uniform float projectionScale; // This is the mercator scale (2 ** zoom)


float scale(float position) {
  return project_scale(position);
}

vec2 scale(vec2 position) {
  return project_scale(position);
}

vec3 scale(vec3 position) {
  return project_scale(position);
}

vec4 scale(vec4 position) {
  return project_scale(position);
}

vec2 preproject(vec2 position) {
  return project_position(position);
}

vec3 preproject(vec3 position) {
  return project_position(position);
}

vec4 preproject(vec4 position) {
  return project_position(position);
}

vec4 project(vec4 position) {
  return project_to_clipspace(position);
}
`;

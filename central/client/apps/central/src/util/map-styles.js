/*
Copyright 2025 ODK Central Developers
See the NOTICE file at the top-level directory of this distribution and at
https://github.com/getodk/central-frontend/blob/master/NOTICE.

This file is part of ODK Central. It is subject to the license terms in
the LICENSE file found in the top-level directory of this distribution and at
https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
including this file, may be copied, modified, propagated, or distributed
except according to the terms contained in the LICENSE file.
*/
import mapLocationIcon from '../assets/images/geojson-map/map-location.svg';

// Filters
const not = (x) => ['!', x];
const eq = (x, y) => ['==', x, y];
const ne = (x, y) => ['!=', x, y];
const all = (...xs) => ['all', ...xs];
const geometryType = (...types) => ['in', ['geometry-type'], ['literal', types]];
const isCluster = ['has', 'clusterSize'];
const getId = ['get', 'id'];
const selectedId = ['var', 'selectedId'];

// featureColor is the color of features on the map. It's a purple color. We
// considered blue, but that seemed too similar to the color of water on the
// map. We also considered magenta, but the OSM base map uses magenta for
// certain features.
//
// Field Data: on the Gradient ramp this is iris-700, not the iris-600 the rest
// of the interface uses for its accent. The reasoning above still holds and is
// measurable: against the colors OSM actually paints, iris-600 falls to 3.6 to
// one on water, where iris-700 holds 4.7 -- the margin the original purple had
// at 4.8. Brand coherence is not worth a marker somebody cannot pick out of a
// river.
//
// This colour lives in JavaScript, which is why the sweep that moved the rest
// of the interface onto the ramp walked past it: that one rewrote style blocks
// and stylesheets only.
const featureColor = '#4b3ccb'; // gradient --iris-700
const colorWithAlpha = (alpha) => {
  const alphaHex = Math.round(255 * alpha).toString(16).padStart(2, '0');
  return featureColor + alphaHex;
};

// Styles
const styleCircle = (radius, alpha) => ({
  'circle-radius': radius,
  'circle-fill-color': colorWithAlpha(alpha),
  'circle-displacement': [0, 0]
});
const styleIcon = (length) => ({
  'icon-src': mapLocationIcon,
  'icon-width': length,
  'icon-height': length
});
const styleStroke = (width, color, fillColor = undefined) => {
  const result = { 'stroke-width': width, 'stroke-color': color };
  if (fillColor) result['fill-color'] = fillColor;
  return result;
};

export const getStyles = () => [
  // Unselected Point
  {
    filter: all(geometryType('Point'), not(isCluster), ne(getId, selectedId)),
    style: styleIcon(40)
  },
  // Selected Point
  {
    filter: all(geometryType('Point'), eq(getId, selectedId)),
    style: [styleCircle(30, 0.2), styleIcon(50)]
  },

  // Selected LineString or Polygon
  {
    filter: all(geometryType('LineString', 'Polygon'), eq(getId, selectedId)),
    style: styleStroke(20, colorWithAlpha(0.2), 'transparent')
  },
  // Increase the clickable area of an unselected LineString.
  {
    filter: all(geometryType('LineString'), ne(getId, selectedId)),
    style: styleStroke(20, 'rgba(255, 255, 255, 0.1)')
  },
  // Any LineString or Polygon
  {
    filter: geometryType('LineString', 'Polygon'),
    style: styleStroke(3, featureColor, colorWithAlpha(0.2))
  },

  // Cluster Point
  {
    filter: isCluster,
    style: styleCircle(30, 0.7)
  }
];

export const getTextStyles = () => {
  const style = getComputedStyle(document.body);
  return [
    {
      filter: isCluster,
      style: {
        'text-value': ['get', 'clusterSize'],
        'text-font': `500 ${style.fontSize} ${style.fontFamily}`,
        'text-fill-color': '#fff',
      },
    },
  ];
};

export const getOverlapHintStyles = (radius) => [
  {
    filter: ['has', 'overlapHint'],
    style: styleCircle(radius, 0.51)
  }
];

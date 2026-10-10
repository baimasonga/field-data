// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const { MAX_BYTES } = require('./map-layers');
const { storage } = require('../external/field-data-storage');
const { projectAreaFrom } = require('./location-evidence');

// A layer row with its GeoJSON. Remote (WMS/tile) layers have no geometry here.
const loadLayer = async (row) => {
  if (row.remoteConfig) { const { remoteConfig, storageKey, createdBy, ...safe } = row; return { ...safe, data: { type: 'FeatureCollection', features: [] } }; }
  const stream = await storage.getStream(row.storageKey); const chunks = []; let size = 0;
  try { for await (const chunk of stream) { size += chunk.length; if (size > MAX_BYTES) throw new Error('Layer exceeds limit.'); chunks.push(chunk); } } finally { stream.destroy(); }
  const { storageKey, remoteConfig, createdBy, ...safe } = row;
  return { ...safe, data: JSON.parse(Buffer.concat(chunks).toString()) };
};

// The project's designated area, or why there is none to check against.
const projectAreaFor = async (db, projectId) => {
  const row = await db.maybeOne(sql`select * from field_data_map_layers
    where "projectId" = ${projectId} and definition->>'role' = 'project-area'
    order by position, id limit 1`);
  if (row == null) return { usable: false, reason: 'no-area-set' };
  if (row.remoteConfig) return { usable: false, reason: 'remote-layer', layerId: row.id };
  const layer = await loadLayer(row);
  return { ...projectAreaFrom(layer.data), layerId: row.id, layerRevision: row.revision, title: row.title };
};

module.exports = { loadLayer, projectAreaFor };

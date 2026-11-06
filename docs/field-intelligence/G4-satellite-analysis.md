# G4 satellite analysis and reviewed candidates

Geospatial verification supports explicit retrieval of Sentinel-2 catalogue scenes,
provider footprint checks and a bounded red/NIR pixel comparison. Catalogue search
sends a coarse cell; requests for image blocks can reveal the approximate analysis
area. The reviewer must explicitly allow external requests. Imagery access uses the
configured public catalogue and approved Sentinel COG host; arbitrary raster URLs
are rejected. Provider metadata is a point-in-time snapshot, not a certificate of
physical presence or a guarantee that external content remains unchanged.

The analysis aligns a 320 m square to a common 10 m UTM grid, applies scene
classification and conservative cloud/no-data buffers, and withholds results if
coverage or reported-location accuracy is insufficient. Connected components are
identified using fixed NDVI and reflectance thresholds. Candidates require human
review and are not calibrated probabilities or automatic findings of fraud,
construction, or ground truth. Source snapshots, provider metadata, sampled values,
hashes, masks, candidate geometry and append-only review history are exportable.
A change to the source invalidates the current binding. Access, project state and
source are rechecked after external processing; retries use the original request ID.

The raster worker runs as a bounded child of the internal form compiler. Rasterio,
NumPy and Pillow are pinned in its requirements. Set FIELD_DATA_GEOSPATIAL_ENABLED
=false to disable new external analysis while retaining authorized read-only history.
The Sentinel method is limited to supported assets, latitudes, clear comparable
pixels and reported accuracy up to 50 m. Provider outages and unsupported assets
produce an explicit failed or withheld result. Empirical field effectiveness and
threshold calibration require independently labelled data and remain evaluation
work; synthetic fixtures do not establish field accuracy.

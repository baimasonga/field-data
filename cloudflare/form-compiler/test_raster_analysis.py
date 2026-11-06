import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import numpy as np
import rasterio
from rasterio.vrt import WarpedVRT
import raster_analysis as engine

URL = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/'


def payload():
    scene = lambda side: {'assets': {name: {'url': f'{URL}{side}/{name}.tif', 'scale': 0.0001 if name != 'scl' else 1, 'offset': 0}
                                     for name in ['red', 'nir', 'scl']}}
    return {'location': {'longitude': -13.2344, 'latitude': 8.4801, 'accuracy': 5}, 'before': scene('before'), 'after': scene('after')}


class RasterAnalysisTest(unittest.TestCase):
    def run_files(self, change=False, cloud=False, shift=False):
        data = payload(); crs, affine = engine.grid_for(-13.2344, 8.4801)
        with TemporaryDirectory() as directory:
            paths = {}
            for side in ['before', 'after']:
                for name in ['red', 'nir', 'scl']:
                    values = np.full((32, 32), {'red': 1000, 'nir': 3000, 'scl': 4}[name], dtype='uint16')
                    if side == 'after' and name == 'nir' and change:
                        values[6:10, 6:10] = 7000
                    if cloud and side == 'after' and name == 'scl':
                        values[:] = 9
                    transform = affine
                    if shift and side == 'after':
                        # Same ground pixels, different native pixel resolution and grid.
                        values = np.repeat(np.repeat(values, 2, axis=0), 2, axis=1)
                        transform = affine * rasterio.Affine.scale(0.5, 0.5)
                    path = Path(directory) / f'{side}-{name}.tif'
                    with rasterio.open(path, 'w', driver='GTiff', height=values.shape[0], width=values.shape[1], count=1,
                                       dtype=values.dtype, crs=crs, transform=transform, nodata=0) as dst:
                        dst.write(values, 1)
                    paths[data[side]['assets'][name]['url']] = str(path)
            original = rasterio.open
            def open_fixture(url, **kwargs):
                return original(paths[url], **kwargs)
            with patch.object(engine.rasterio, 'open', side_effect=open_fixture):
                return engine.analyse(data)

    def test_real_geotiff_alignment_has_no_false_positive_on_unchanged_pixels(self):
        result = self.run_files(shift=True)
        self.assertEqual(result['status'], 'analysed')
        self.assertEqual(result['candidates'], [])
        self.assertEqual(result['changedPixelFraction'], 0)
        self.assertEqual(result['meanNdviDelta'], 0)
        self.assertEqual(len(result['before']['pixels']['red']), 1024)
        self.assertEqual(len(result['before']['sampleSha256']), 64)

    def test_known_labelled_change_is_detected_with_correct_area_and_preserved_samples(self):
        result = self.run_files(change=True, shift=True)
        self.assertEqual(result['status'], 'analysed')
        self.assertEqual(len(result['candidates']), 1)
        candidate = result['candidates'][0]
        expected = {row * 32 + col for row in range(6, 10) for col in range(6, 10)}
        predicted = set(candidate['cells'])
        self.assertEqual(predicted, expected)  # fixture precision = recall = 1
        self.assertEqual(candidate['kind'], 'vegetation-gain')
        self.assertEqual(candidate['areaM2'], 1600)
        self.assertNotEqual(result['before']['sampleSha256'], result['after']['sampleSha256'])
        self.assertEqual(candidate['geometry']['type'], 'Polygon')
        self.assertTrue(result['after']['previewPng'].startswith('iVBOR'))
        # Generate an actual engine result for the Node/API contract fixtures.
        fixture = Path(__file__).parent / 'test-fixtures' / 'raster-result.json'
        if os.environ.get("WRITE_RASTER_FIXTURE") == "1":
            fixture.write_text(json.dumps(result))

    def test_cloud_and_nodata_are_withheld_instead_of_no_change(self):
        result = self.run_files(change=True, cloud=True)
        self.assertEqual(result['status'], 'withheld')
        self.assertEqual(result['candidates'], [])
        self.assertEqual(result['pairedValidPixels'], 0)

    def test_assets_and_locations_are_bounded_and_do_not_accept_arbitrary_network_targets(self):
        for url in ['http://127.0.0.1/a.tif', 'https://evil.test/a.tif', URL + '../a.tif', URL + 'a.vrt', URL + 'a.tif?secret=1']:
            self.assertFalse(engine.valid_asset(url))
        for longitude, latitude in [(180, 0), (0, 89), (True, 0), (0, float('nan'))]:
            with self.assertRaises(ValueError): engine.grid_for(longitude, latitude)
        data = payload(); data['location']['accuracy'] = None
        self.assertEqual(engine.analyse(data)['status'], 'withheld')


if __name__ == '__main__':
    unittest.main()

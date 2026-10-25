// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const dimensions = (bytes, type) => {
  if (type === 'image/png' && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return [view.getUint32(16), view.getUint32(20)];
  }
  if (type === 'image/jpeg') {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 255) return null;
      while (bytes[offset] === 255) offset += 1;
      const marker = bytes[offset]; offset += 1;
      if (marker === 217 || marker === 218) return null;
      if (marker === 216 || (marker >= 208 && marker <= 215)) continue; // eslint-disable-line no-continue
      const length = bytes[offset] * 256 + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) return null;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return [bytes[offset + 5] * 256 + bytes[offset + 6], bytes[offset + 3] * 256 + bytes[offset + 4]];
      offset += length;
    }
  }
  return null;
};
const features = async (bytes, type) => {
  const size = dimensions(bytes, type);
  if (!size || size.some(value => !Number.isFinite(value) || value < 1 || value > 10000) || size[0] * size[1] > 16000000) throw new Error('Unsupported dimensions; use images within 16 megapixels and 10,000 pixels per side.');
  const image = await createImageBitmap(new Blob([bytes], { type }));
  try {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.fillStyle = '#fff'; context.fillRect(0, 0, 32, 32); context.drawImage(image, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data; const gray = []; const colors = new Array(24).fill(0);
    for (let i = 0; i < pixels.length; i += 4) { gray.push(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]); for (let channel = 0; channel < 3; channel += 1) colors[channel * 8 + Math.min(7, Math.floor(pixels[i + channel] / 32))] += 1 / 3072; }
    const mean = gray.reduce((sum, value) => sum + value, 0) / gray.length; const variance = gray.reduce((sum, value) => sum + (value - mean) ** 2, 0) / gray.length;
    const dct = [];
    for (let u = 0; u < 8; u += 1) for (let v = 0; v < 8; v += 1) {
      if (u === 0 && v === 0) continue; // eslint-disable-line no-continue
      let value = 0; for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) value += gray[y * 32 + x] * Math.cos(((2 * x + 1) * u * Math.PI) / 64) * Math.cos(((2 * y + 1) * v * Math.PI) / 64);
      dct.push(value);
    }
    const median = [...dct].sort((a, b) => a - b)[31]; const phash = dct.map(value => value > median);
    canvas.width = 9; canvas.height = 8; context.fillStyle = '#fff'; context.fillRect(0, 0, 9, 8); context.drawImage(image, 0, 0, 9, 8);
    const small = context.getImageData(0, 0, 9, 8).data; const dhash = [];
    const luma = i => 0.299 * small[i * 4] + 0.587 * small[i * 4 + 1] + 0.114 * small[i * 4 + 2];
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) dhash.push(luma(y * 9 + x) > luma(y * 9 + x + 1));
    return { variance, phash, dhash, colors, width: size[0], height: size[1] };
  } finally { image.close(); }
};
export default async (left, right) => {
  try {
    const [a, b] = await Promise.all([features(left.bytes, left.type), features(right.bytes, right.type)]);
    if (Math.min(a.variance, b.variance) < 15) return { method: 'local-perceptual-review@1', status: 'inconclusive', reason: 'At least one image has too little visual variation for reliable perceptual comparison.' };
    const perceptualBitsDifferent = a.phash.filter((value, i) => value !== b.phash[i]).length;
    const edgeBitsDifferent = a.dhash.filter((value, i) => value !== b.dhash[i]).length;
    const colorDistance = a.colors.reduce((sum, value, i) => sum + Math.abs(value - b.colors[i]), 0);
    return {
      method: 'local-perceptual-review@1', status: perceptualBitsDifferent <= 12 && edgeBitsDifferent <= 16 && colorDistance <= 0.5 ? 'similar-visual-content' : 'different-appearance',
      perceptualBitsDifferent, perceptualBits: 63, edgeBitsDifferent, edgeBits: 64, colorDistance, dimensions: [[a.width, a.height], [b.width, b.height]],
      thresholds: { perceptualBits: 12, edgeBits: 16, colorDistance: 0.5 }, limitations: 'Fixed uncalibrated review thresholds, not an identity probability. Crops, rotation, viewpoint, lighting and reused pictures can change or fool the comparison. Human source review is required.'
    };
  } catch (error) { return { method: 'local-perceptual-review@1', status: 'unavailable', reason: error.message }; }
};

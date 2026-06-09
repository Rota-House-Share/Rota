// =============================================================================
// Shared utilities — included on every page that needs them
// =============================================================================

/**
 * Compress an image file to under maxBytes before uploading.
 * Scales down to 1280px max dimension, tries JPEG quality 0.8 then 0.6.
 * Falls back to the original file if anything goes wrong.
 *
 * @param {File|Blob} file
 * @param {number} maxBytes - default 1.5 MB
 * @returns {Promise<Blob>}
 */
function compressImage(file, maxBytes = 1.5 * 1024 * 1024) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      const maxDim = 1280;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => {
        if (blob && blob.size <= maxBytes) { resolve(blob); return; }
        canvas.toBlob(blob2 => resolve(blob2 || blob), 'image/jpeg', 0.6);
      }, 'image/jpeg', 0.8);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

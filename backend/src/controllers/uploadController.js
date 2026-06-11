// =============================================================================
// UPLOAD CONTROLLER
//
// All file uploads go to Cloudflare R2 (S3-compatible object storage).
// multer uses memoryStorage — files are held in RAM just long enough to
// stream to R2, then the buffer is discarded. Nothing is written to disk.
//
// Every upload handler:
//   1. Validates MIME type (server-side, never trust the client)
//   2. Enforces a 5 MB file size cap
//   3. Uploads to R2 under the appropriate folder prefix
//   4. Returns a permanent public URL to store in the database
// =============================================================================

const multer   = require('multer');
const { randomUUID } = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const pool = require('../db/pool');

// ── R2 client (S3-compatible) ─────────────────────────────────────────────────
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET      = process.env.R2_BUCKET_NAME;
const PUBLIC_URL  = process.env.R2_PUBLIC_URL; // e.g. https://pub-xxx.r2.dev  (set after enabling public access)

const MAX_BYTES     = 5 * 1024 * 1024;
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT   = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

// All multer instances use memory storage — no disk writes
const memStorage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return cb(new Error('Only JPEG, PNG, or WebP images are allowed.'), false);
  }
  cb(null, true);
};

// ── Helper: upload a buffer to R2, return the public URL ─────────────────────
async function uploadToR2(buffer, mimeType, folder) {
  const ext = ALLOWED_EXT[mimeType] || '.bin';
  const key = `${folder}/${randomUUID()}${ext}`;
  await r2.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: mimeType,
  }));
  return `${PUBLIC_URL}/${key}`;
}

// ── Helper: delete a file from R2 by its public URL ──────────────────────────
async function deleteFromR2(publicUrl) {
  if (!publicUrl || !PUBLIC_URL || !publicUrl.startsWith(PUBLIC_URL)) return;
  const key = publicUrl.replace(PUBLIC_URL + '/', '');
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (_) {}
}

// ── Avatar upload ─────────────────────────────────────────────────────────────
const uploadAvatar = multer({
  storage:   memStorage,
  fileFilter,
  limits: { fileSize: MAX_BYTES, files: 1 }
}).single('avatar');

const handleAvatarUpload = (req, res, next) => {
  uploadAvatar(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large. Max 5 MB.' });
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file received.' });

    try {
      const publicUrl = await uploadToR2(req.file.buffer, req.file.mimetype, 'avatars');

      // Delete old avatar from R2
      const prev = await pool.query('SELECT avatar_url FROM users WHERE id = $1', [req.user.id]);
      await deleteFromR2(prev.rows[0]?.avatar_url);

      await pool.query(
        'UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2',
        [publicUrl, req.user.id]
      );
      res.json({ avatar_url: publicUrl });
    } catch (dbErr) {
      next(dbErr);
    }
  });
};

// ── Request photos (up to 3) ──────────────────────────────────────────────────
const uploadRequestPhotos = multer({
  storage:   memStorage,
  fileFilter,
  limits: { fileSize: MAX_BYTES, files: 3 }
}).array('photos', 3);

const handleRequestPhotos = (req, res, next) => {
  uploadRequestPhotos(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE')  return res.status(413).json({ error: 'Each photo must be under 5 MB.' });
      if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Maximum 3 photos allowed.' });
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    }
    try {
      const urls = await Promise.all(
        (req.files || []).map(f => uploadToR2(f.buffer, f.mimetype, 'requests'))
      );
      req.photoUrls = urls;
      next();
    } catch (uploadErr) {
      next(uploadErr);
    }
  });
};

// ── Proof photos (before + after) ────────────────────────────────────────────
const uploadProof = multer({
  storage:   memStorage,
  fileFilter,
  limits: { fileSize: MAX_BYTES, files: 2 }
}).fields([
  { name: 'proof_before', maxCount: 1 },
  { name: 'proof_after',  maxCount: 1 },
]);

const handleProofUpload = (req, res, next) => {
  uploadProof(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Each proof photo must be under 5 MB.' });
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    }
    try {
      const files      = req.files || {};
      const beforeFile = files.proof_before?.[0];
      const afterFile  = files.proof_after?.[0];

      if (!beforeFile || !afterFile) {
        return res.status(400).json({ error: 'Both before and after photos are required.' });
      }

      const [beforeUrl, afterUrl] = await Promise.all([
        uploadToR2(beforeFile.buffer, beforeFile.mimetype, 'proofs'),
        uploadToR2(afterFile.buffer,  afterFile.mimetype,  'proofs'),
      ]);

      req.proofUrl = JSON.stringify({ before: beforeUrl, after: afterUrl });
      next();
    } catch (uploadErr) {
      next(uploadErr);
    }
  });
};

module.exports = { handleAvatarUpload, handleRequestPhotos, handleProofUpload };

import { join } from 'node:path';
import { config } from '../config.js';
import { saveUpload, verifyMagicBytes, uploadPath, removeQuietly } from '../storage.js';

const KINDS = new Set(['image', 'video']);

export async function uploadRoutes(app) {
  app.post('/api/uploads', async (req, reply) => {
    let file;
    try {
      file = await req.file({ limits: { fileSize: config.maxUploadBytes, files: 1 } });
    } catch (err) {
      return reply.code(400).send({ error: 'invalid multipart body' });
    }
    if (!file) {
      return reply.code(400).send({ error: 'no file provided' });
    }
    const kindField = file.fields && file.fields.kind;
    const kind = kindField && kindField.value && KINDS.has(kindField.value) ? kindField.value : 'image';
    try {
      const { key, size } = await saveUpload(file.file, file.filename, kind, config.maxUploadBytes);
      try {
        await verifyMagicBytes(uploadPath(key), kind);
      } catch (verifyErr) {
        await removeQuietly(uploadPath(key));
        throw verifyErr;
      }
      return reply.send({ fileKey: key, size });
    } catch (err) {
      if (err.statusCode === 413) {
        return reply.code(413).send({ error: 'file too large' });
      }
      if (err.statusCode === 400) {
        return reply.code(400).send({ error: 'file content does not match its type' });
      }
      req.log.error(err);
      return reply.code(500).send({ error: 'upload failed' });
    }
  });
}

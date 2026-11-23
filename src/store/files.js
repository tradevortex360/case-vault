// Binary files (PDFs, evidence, receipts). Stored on the device first so they work
// offline; uploaded to the right Drive folder when a connection is available.
import { uid } from './ops.js';

export async function storeLocalFile(v, file, folder) {
  const localId = 'local:' + uid();
  await v.cacheFile(localId, file);
  return { fileId: localId, fileName: file.name, fileType: file.type, fileFolder: folder, pendingUpload: true };
}

// Called after each sync: push any device-only files up to Drive.
export async function uploadPendingFiles(v) {
  const a = v.adapter; if (!a?.upload) return 0;
  let n = 0;
  for (const coll of ['documents', 'evidence', 'expenses']) {
    for (const r of v.list(coll, x => x.pendingUpload && String(x.fileId).startsWith('local:'))) {
      const blob = await v.db.get('files', r.fileId); if (!blob) continue;
      const id = await a.upload(r.fileName || (r.title || 'file') + '.pdf', blob, r.fileFolder || coll);
      await v.cacheFile(id, blob); await v.db.delete('files', r.fileId);
      await v.patch(coll, r.id, { fileId: id, pendingUpload: false }); n++;
    }
  }
  return n;
}

// Imported documents carry a file name; once the PDF is in Drive (documents/ or inbox/) link it automatically.
export async function linkFilesByName(v) {
  const a = v.adapter; if (!a?.findByName) return 0;
  let n = 0;
  for (const d of v.list('documents', x => !x.fileId && x.fileName)) {
    const f = (await a.findByName(d.fileName, 'documents')) || (await a.findByName(d.fileName, 'inbox'));
    if (f) { await v.patch('documents', d.id, { fileId: f.id }); n++; }
  }
  return n;
}

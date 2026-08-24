export interface UploadInput {
  buffer: Buffer;
  mimeType: string;
  size: number; // taille en octets
  originalName: string;
  keyPrefix?: string; // ex. 'tickets/<id>/attachments' ; sinon préfixe par défaut
}

export interface StoredObject {
  key: string;
  bucket: string;
  mimeType: string;
  size: number;
}

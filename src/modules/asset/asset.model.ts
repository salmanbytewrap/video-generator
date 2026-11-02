import { InferSchemaType, model, Schema } from 'mongoose';

const assetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['video', 'image'], required: true },
    role: { type: String, enum: ['input', 'output', 'thumbnail'], required: true, default: 'input' },
    mimeType: { type: String, required: true },
    originalName: { type: String, required: true },
    size: { type: Number, required: true },
    storageKey: { type: String, required: true, unique: true },
    source: { type: String, enum: ['upload', 'url', 'generated'], required: true, default: 'upload' },
    sourceUrl: { type: String },
    title: { type: String },
    metadata: {
      width: { type: Number, required: true },
      height: { type: Number, required: true },
      durationSeconds: { type: Number },
      videoCodec: { type: String },
      audioCodec: { type: String },
      hasAudio: { type: Boolean, default: false },
      frameRate: { type: Number },
    },
    expiresAt: { type: Date, index: true },
  },
  { timestamps: true },
);

export type AssetSchema = InferSchemaType<typeof assetSchema>;

export const AssetModel = model('Asset', assetSchema);

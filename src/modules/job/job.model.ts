import { InferSchemaType, model, Schema } from 'mongoose';
import { FIT_MODES, PLATFORMS } from '../generation/platformPresets';

export const JOB_STATUSES = ['queued', 'processing', 'completed', 'failed', 'cancelled'] as const;

const jobSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    inputAssetId: { type: Schema.Types.ObjectId, ref: 'Asset', required: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    format: { type: String, required: true },
    options: {
      fit: { type: String, enum: FIT_MODES, default: 'crop' },
      trimStartSeconds: { type: Number, default: 0 },
      generateCaption: { type: Boolean, default: true },
    },
    status: { type: String, enum: JOB_STATUSES, required: true, default: 'queued' },
    progress: { type: Number, default: 0 },
    stage: { type: String, default: 'queued' },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, required: true },
    runAfter: { type: Date, default: () => new Date() },
    lockedBy: { type: String },
    lockedUntil: { type: Date },
    cancelRequested: { type: Boolean, default: false },
    idempotencyKey: { type: String },
    error: {
      code: { type: String },
      message: { type: String },
      retryable: { type: Boolean },
    },
    outputAssetId: { type: Schema.Types.ObjectId, ref: 'Asset' },
    thumbnailAssetId: { type: Schema.Types.ObjectId, ref: 'Asset' },
    caption: {
      text: { type: String },
      hashtags: { type: [String], default: undefined },
      simulated: { type: Boolean },
    },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

jobSchema.index({ status: 1, runAfter: 1, createdAt: 1 });
jobSchema.index({ status: 1, lockedUntil: 1 });
jobSchema.index({ userId: 1, createdAt: -1 });
jobSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export type JobSchema = InferSchemaType<typeof jobSchema>;

export const JobModel = model('Job', jobSchema);

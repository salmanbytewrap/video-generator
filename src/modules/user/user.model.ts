import { Schema, model, InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
  },
  { timestamps: true },
);

export type UserSchema = InferSchemaType<typeof userSchema>;

export const UserModel = model('User', userSchema);

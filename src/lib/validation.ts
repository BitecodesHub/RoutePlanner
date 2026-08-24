import { z } from "zod";

/** Shared request DTO schemas. All API inputs are validated with these. */

export const latSchema = z.number().min(-90).max(90);
export const lngSchema = z.number().min(-180).max(180);

export const shopCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional().nullable(),
  latitude: latSchema,
  longitude: lngSchema,
  contactName: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().nullable(),
  externalRef: z.string().trim().max(100).optional().nullable(),
});

export const shopUpdateSchema = shopCreateSchema.partial().extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const shopListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  sort: z.enum(["name", "createdAt", "updatedAt"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

export const driverCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(30).optional().nullable(),
  password: z.string().min(8).max(100).optional(), // omit to auto-generate
});

export const driverUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  phone: z.string().trim().max(30).optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(100),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(100),
  newPassword: z.string().min(8).max(100),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  newPassword: z.string().min(8).max(100),
});

export const startPointSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  label: z.string().trim().max(300).optional(),
});

export const optimizePreviewSchema = z.object({
  start: startPointSchema,
  shopIds: z.array(z.string().min(1)).min(1).max(200),
});

export const routeCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  start: startPointSchema,
  shopIds: z.array(z.string().min(1)).min(1).max(200),
  /** When provided, use this explicit stop order instead of optimising. */
  manualOrder: z.boolean().default(false),
  scheduledFor: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const routeUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  scheduledFor: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  /** Reorder / replace stops (shop ids in desired order). */
  shopIds: z.array(z.string().min(1)).min(1).max(200).optional(),
  /** Re-run the optimiser over the current stops. */
  reoptimize: z.boolean().optional(),
  start: startPointSchema.optional(),
});

export const routeAssignSchema = z.object({
  driverId: z.string().min(1).nullable(), // null unassigns
});

export const routeStatusSchema = z.object({
  status: z.enum(["DRAFT", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
});

export const stopStatusSchema = z.object({
  status: z.enum(["PENDING", "ARRIVED", "COMPLETED", "SKIPPED"]),
  notes: z.string().trim().max(1000).optional(),
});

export const routeListQuerySchema = z.object({
  status: z.enum(["DRAFT", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "ALL"]).default("ALL"),
  driverId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

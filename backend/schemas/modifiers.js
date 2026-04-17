const { z } = require("zod");

const createGroupSchema = z.object({
  outlet_id: z.number().int().positive().optional().nullable(),
  name: z.string().min(1),
  selection_type: z.enum(["single", "multi"]),
  min_select: z.number().int().min(0).default(0),
  max_select: z.number().int().min(0).optional().nullable(),
  is_required: z.boolean().default(false),
  display_order: z.number().int().default(0),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).optional(),
  selection_type: z.enum(["single", "multi"]).optional(),
  min_select: z.number().int().min(0).optional(),
  max_select: z.number().int().min(0).optional().nullable(),
  is_required: z.boolean().optional(),
  display_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

const createOptionSchema = z.object({
  name: z.string().min(1),
  price_delta: z.number().default(0),
  is_default: z.boolean().default(false),
  display_order: z.number().int().default(0),
});

const updateOptionSchema = z.object({
  name: z.string().min(1).optional(),
  price_delta: z.number().optional(),
  is_default: z.boolean().optional(),
  display_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

const linkGroupSchema = z.object({
  group_id: z.number().int().positive(),
  display_order: z.number().int().default(0),
});

const attachModifiersSchema = z.object({
  draft_order_item_id: z.number().int().positive(),
  option_ids: z.array(z.number().int().positive()).min(1),
});

module.exports = {
  createGroupSchema,
  updateGroupSchema,
  createOptionSchema,
  updateOptionSchema,
  linkGroupSchema,
  attachModifiersSchema,
};

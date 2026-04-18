const { z } = require("zod");

const createFloorPlanSchema = z.object({
  name: z.string().min(1),
  outlet_id: z.number().int().positive(),
  layout_json: z.any().optional(),
});

const updateFloorPlanSchema = z.object({
  name: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
  layout_json: z.any().optional(),
});

const createTableSchema = z.object({
  floor_plan_id: z.number().int().positive(),
  section_id: z.number().int().positive().optional(),
  label: z.string().min(1),
  capacity: z.number().int().positive().default(4),
  shape: z.enum(["square", "round", "rectangle"]).default("square"),
  pos_x: z.number().int().default(0),
  pos_y: z.number().int().default(0),
});

const updateTableSchema = z.object({
  label: z.string().min(1).optional(),
  section_id: z.number().int().positive().optional().nullable(),
  capacity: z.number().int().positive().optional(),
  shape: z.enum(["square", "round", "rectangle"]).optional(),
  pos_x: z.number().int().optional(),
  pos_y: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

const createSessionSchema = z.object({
  table_id: z.number().int().positive(),
  server_id: z.number().int().positive().optional(),
  guest_count: z.number().int().positive().default(1),
});

const createCheckSchema = z.object({
  table_session_id: z.number().int().positive().optional(),
  tab_id: z.number().int().positive().optional(),
  order_context: z.enum(["dine_in", "takeout", "delivery", "bar", "drive_thru"]).default("dine_in"),
  dining_option: z.enum(["dine_in", "takeout", "delivery"]).optional(),
  outlet_id: z.number().int().positive(),
  seat_count: z.number().int().min(0).default(0),
});

const splitCheckSchema = z.object({
  split_type: z.enum(["by_item", "by_seat", "equal", "by_amount", "evenly"]),
  parts: z.number().int().min(2).optional(),
  item_assignments: z.array(z.object({
    item_id: z.number().int().positive(),
    target_check_index: z.number().int().min(0),
  })).optional(),
}).superRefine((data, ctx) => {
  if ((data.split_type === "by_amount" || data.split_type === "evenly" || data.split_type === "equal") && !data.parts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "parts is required when split_type is by_amount/evenly/equal",
      path: ["parts"],
    });
  }
  if (data.split_type === "by_item" && (!data.item_assignments || data.item_assignments.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "item_assignments required for by_item split",
      path: ["item_assignments"],
    });
  }
});

const mergeChecksSchema = z.object({
  target_id: z.number().int().positive(),
  source_ids: z.array(z.number().int().positive()).min(1),
});

const fireCourseSchema = z.object({
  course_name: z.string().min(1),
});

const holdCourseSchema = z.object({
  course_name: z.string().min(1),
  hold_until: z.string().datetime(),
});

const expediteCourseSchema = z.object({
  course_name: z.string().min(1),
});

const createTabSchema = z.object({
  outlet_id: z.number().int().positive(),
  customer_id: z.number().int().positive().optional(),
  customer_name: z.string().optional(),
});

const createKdsStationSchema = z.object({
  outlet_id: z.number().int().positive(),
  name: z.string().min(1),
  station_role: z.enum(["prep", "expo"]).default("prep"),
});

const updateKdsStationSchema = z.object({
  name: z.string().min(1).optional(),
  station_role: z.enum(["prep", "expo"]).optional(),
  is_active: z.boolean().optional(),
});

// Phase 2.1 B1 — KDS routing rules. Exactly one of product_id / modifier_group_id
// / category_id / match_all must be set (DB CHECK re-enforces). station_role_filter
// narrows the rule to stations with a specific role when non-null.
const createKdsRouteSchema = z.object({
  outlet_id: z.number().int().positive(),
  station_id: z.number().int().positive(),
  priority: z.number().int().min(0).default(0),
  product_id: z.number().int().positive().nullable().optional(),
  modifier_group_id: z.number().int().positive().nullable().optional(),
  category_id: z.number().int().positive().nullable().optional(),
  match_all: z.boolean().optional(),
  station_role_filter: z.enum(["prep", "expo"]).nullable().optional(),
}).superRefine((data, ctx) => {
  const set = [
    data.product_id != null,
    data.modifier_group_id != null,
    data.category_id != null,
    data.match_all === true,
  ].filter(Boolean).length;
  if (set !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Exactly one of product_id / modifier_group_id / category_id / match_all must be set",
      path: ["match_all"],
    });
  }
});

const updateKdsRouteSchema = z.object({
  priority: z.number().int().min(0).optional(),
  product_id: z.number().int().positive().nullable().optional(),
  modifier_group_id: z.number().int().positive().nullable().optional(),
  category_id: z.number().int().positive().nullable().optional(),
  match_all: z.boolean().optional(),
  station_role_filter: z.enum(["prep", "expo"]).nullable().optional(),
  station_id: z.number().int().positive().optional(),
});

module.exports = {
  createFloorPlanSchema, updateFloorPlanSchema,
  createTableSchema, updateTableSchema,
  createSessionSchema, createCheckSchema,
  splitCheckSchema, mergeChecksSchema, fireCourseSchema,
  holdCourseSchema, expediteCourseSchema,
  createTabSchema,
  createKdsStationSchema, updateKdsStationSchema,
  createKdsRouteSchema, updateKdsRouteSchema,
};

const { z } = require("zod");

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  customer_id: z.number().int().positive().optional(),
  outlet_id: z.number().int().positive().optional(),
  start_date: z.string().optional(),
  target_end_date: z.string().optional(),
  budget: z.number().min(0).optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(["draft", "active", "on_hold", "completed", "cancelled"]).optional(),
  start_date: z.string().optional(),
  target_end_date: z.string().optional(),
  actual_end_date: z.string().optional(),
  budget: z.number().min(0).optional(),
});

const createMilestoneSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  due_date: z.string().optional(),
  amount: z.number().min(0).optional(),
  invoice_on_completion: z.boolean().default(false),
  sort_order: z.number().int().min(0).default(0),
});

const updateMilestoneSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  due_date: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "skipped"]).optional(),
  amount: z.number().min(0).optional(),
  sort_order: z.number().int().min(0).optional(),
});

module.exports = {
  createProjectSchema, updateProjectSchema,
  createMilestoneSchema, updateMilestoneSchema,
};

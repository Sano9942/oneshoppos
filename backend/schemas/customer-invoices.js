const { z } = require("zod");

const invoiceItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit_price: z.number().min(0),
  tax_rate: z.number().min(0).default(0),
  product_id: z.number().int().positive().optional(),
  variant_id: z.number().int().positive().optional(),
});

const reminderRuleSchema = z.object({
  reminder_type: z.enum(["before_due", "on_due", "after_due"]),
  days_offset: z.number().int().min(0),
  channel: z.enum(["email", "sms"]).default("email"),
});

const createInvoiceSchema = z.object({
  customer_id: z.number().int().positive(),
  items: z.array(invoiceItemSchema).min(1),
  due_date: z.string().optional(),
  notes: z.string().optional(),
  outlet_id: z.number().int().positive().optional(),
  discount_amount: z.number().min(0).default(0),
  reminders: z.array(reminderRuleSchema).optional(),
});

const batchInvoiceSchema = z.object({
  customer_ids: z.array(z.number().int().positive()).min(1),
  items: z.array(invoiceItemSchema).min(1),
  due_date: z.string().optional(),
  notes: z.string().optional(),
  discount_amount: z.number().min(0).default(0),
});

const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  payment_method: z.string().min(1),
  payment_type: z.enum(["payment", "deposit", "refund"]).default("payment"),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

module.exports = { createInvoiceSchema, batchInvoiceSchema, recordPaymentSchema };

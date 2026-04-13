"use strict";

const { z } = require("zod");

const STATUSES = ["intake", "approved", "in_progress", "on_hold", "completed", "invoiced", "cancelled"];

const createTicketSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  customer_id: z.number().int().positive().optional(),
  outlet_id: z.number().int().positive().optional(),
  assigned_to: z.number().int().positive().optional(),
  expected_completion: z.string().optional(),
  deposit_amount: z.number().min(0).optional(),
  deposit_method: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
});

const updateTicketSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).optional(),
  customer_id: z.number().int().positive().nullable().optional(),
  outlet_id: z.number().int().positive().nullable().optional(),
  assigned_to: z.number().int().positive().nullable().optional(),
  expected_completion: z.string().nullable().optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(STATUSES).optional(),
}).strict();

const addNoteSchema = z.object({
  description: z.string().min(1).max(2000),
});

module.exports = { createTicketSchema, updateTicketSchema, addNoteSchema, STATUSES };

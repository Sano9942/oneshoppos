"use strict";

/**
 * country-packs.js — Public API for country configuration
 *
 * GET /api/country-packs        — list all (summary: code, name, currency, timezone)
 * GET /api/country-packs/:code  — full pack details
 *
 * Both endpoints are public (no auth) — mounted before auth middleware.
 */

const express = require("express");
const { getAllCountryPacks, getCountryPack, COUNTRY_PACKS } = require("../config/country-packs");

module.exports = function createCountryPacksRouter() {
  const router = express.Router();

  // GET /api/country-packs — summary list
  router.get("/", (_req, res) => {
    const packs = getAllCountryPacks().map((p) => ({
      code: p.code,
      name: p.name,
      currency_symbol: p.currency_symbol,
      currency_code: p.currency_code,
      timezone_default: p.timezone_default,
    }));
    res.json(packs);
  });

  // GET /api/country-packs/:code — full details
  router.get("/:code", (req, res) => {
    const code = req.params.code.toUpperCase();
    if (!COUNTRY_PACKS[code]) {
      return res.status(404).json({ error: `Country pack "${code}" not found` });
    }
    res.json(getCountryPack(code));
  });

  return router;
};

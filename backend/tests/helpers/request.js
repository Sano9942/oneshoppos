/**
 * request.js — Supertest wrapper with default auth headers.
 *
 * Usage:
 *   const { makeRequest } = require('./request');
 *   const req = makeRequest(app);           // no auth (anonymous)
 *   const req = makeRequest(app, 1);        // as admin (employee id=1)
 *   const req = makeRequest(app, 2);        // as manager (employee id=2)
 *   const req = makeRequest(app, 3);        // as cashier (employee id=3)
 *
 *   await req.get('/api/products').expect(200);
 *   await req.post('/api/sales').send({...}).expect(200);
 */

const supertest = require("supertest");

function makeRequest(app, employeeId) {
  const agent = supertest(app);

  if (!employeeId) return agent;

  // Return a proxy that auto-sets the x-employee-id header on every request
  return new Proxy(agent, {
    get(target, prop) {
      if (["get", "post", "put", "delete", "patch"].includes(prop)) {
        return (...args) => {
          return target[prop](...args).set("x-employee-id", String(employeeId));
        };
      }
      return target[prop];
    },
  });
}

// Convenience aliases
const ADMIN_ID = 1;
const MANAGER_ID = 2;
const CASHIER_ID = 3;

module.exports = { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID };

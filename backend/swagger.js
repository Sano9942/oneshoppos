const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "SanoPOS API",
      version: "1.0.0",
      description:
        "Public API documentation for SanoPOS — a multi-tenant Point of Sale system with Shopify integration, inventory management, and full retail operations.",
      contact: { name: "SanoPOS Support", url: "https://sanopos.com" },
    },
    servers: [
      { url: "https://api.sanopos.com", description: "Production" },
      { url: "http://localhost:5000", description: "Local development" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT token obtained from /api/auth/mt-login",
        },
      },
      schemas: {
        Product: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            sku: { type: "string" },
            barcode: { type: "string", nullable: true },
            price: { type: "number", format: "double" },
            cost_price: { type: "number", format: "double", nullable: true },
            stock: { type: "integer" },
            category_id: { type: "integer", nullable: true },
            brand_id: { type: "integer", nullable: true },
            is_active: { type: "boolean" },
            created_at: { type: "string", format: "date-time" },
          },
        },
        Sale: {
          type: "object",
          properties: {
            id: { type: "integer" },
            invoice_number: { type: "string" },
            total: { type: "number", format: "double" },
            discount: { type: "number", format: "double" },
            tax: { type: "number", format: "double" },
            payment_method: { type: "string", enum: ["cash", "card", "credit", "split"] },
            customer_id: { type: "integer", nullable: true },
            employee_id: { type: "integer" },
            outlet_id: { type: "integer" },
            timestamp: { type: "string", format: "date-time" },
            voided: { type: "boolean" },
          },
        },
        Customer: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            phone: { type: "string", nullable: true },
            email: { type: "string", nullable: true },
            address: { type: "string", nullable: true },
            loyalty_points: { type: "integer" },
            created_at: { type: "string", format: "date-time" },
          },
        },
        Order: {
          type: "object",
          properties: {
            id: { type: "integer" },
            order_number: { type: "string" },
            customer_id: { type: "integer", nullable: true },
            status: { type: "string", enum: ["pending", "confirmed", "shipped", "delivered", "cancelled"] },
            total: { type: "number", format: "double" },
            created_at: { type: "string", format: "date-time" },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
    tags: [
      { name: "Auth", description: "Authentication and session management" },
      { name: "Products", description: "Product catalog CRUD" },
      { name: "Sales", description: "Point of sale transactions" },
      { name: "Returns", description: "Sale returns and refunds" },
      { name: "Customers", description: "Customer management and CRM" },
      { name: "Orders", description: "Order management" },
      { name: "Reports", description: "Business analytics and reporting" },
      { name: "Billing", description: "Subscription billing and pricing" },
    ],
  },
  apis: ["./routes/*.js", "./routes/**/*.js"],
};

module.exports = swaggerJsdoc(options);

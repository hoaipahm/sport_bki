import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Sports Court Booking Platform API',
    version: '2.0.0',
    description: 'Multi-tenant SaaS Platform for Sports Court Bookings (Vietnam Market - VND Currency)',
    contact: {
      name: 'Engineering Team',
      email: 'support@tenmien.vn',
    },
  },
  servers: [
    {
      url: 'http://localhost:4000',
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Provide portal-specific JWT access token',
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health Check & Service Status',
        responses: {
          200: {
            description: 'Database and Redis are connected',
          },
        },
      },
    },
    '/api/customer/v1/auth/register': {
      post: {
        summary: 'Customer Registration (Sends 6-digit OTP to Email)',
        tags: ['Customer Portal'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  username: { type: 'string', example: 'hoanguyen' },
                  email: { type: 'string', example: 'hoa.nguyen+test@gmail.com' },
                  phone: { type: 'string', example: '0912345678' },
                  password: { type: 'string', example: 'SecretPassword@123' },
                  preferred_language: { type: 'string', enum: ['vi', 'en'], example: 'vi' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'OTP sent to email' } },
      },
    },
    '/api/customer/v1/venues': {
      get: {
        summary: 'Search Venues (Accent-Insensitive Search)',
        tags: ['Customer Portal'],
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search name or address without diacritics' },
        ],
        responses: { 200: { description: 'List of venues' } },
      },
    },
    '/api/customer/v1/bookings': {
      post: {
        summary: 'Create 10-Minute Booking Hold & Generate VietQR',
        tags: ['Customer Portal'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  venue_id: { type: 'string', format: 'uuid' },
                  court_id: { type: 'string', format: 'uuid' },
                  start_at: { type: 'string', format: 'date-time' },
                  end_at: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Booking held, returns VietQR link and frozen price' },
          409: { description: 'SLOT_TAKEN: Conflict detected by PostgreSQL Exclusion Constraint' },
        },
      },
    },
    '/api/staff/v1/shifts/open': {
      post: {
        summary: 'Open Staff Cash Shift',
        tags: ['Staff Portal'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  venue_id: { type: 'string', format: 'uuid' },
                  opening_cash: { type: 'integer', example: 500000, description: 'VND Integer' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Shift opened' } },
      },
    },
    '/api/admin/v1/uploads': {
      post: {
        summary: 'Upload Court & Venue Photos (Supports up to 25MB with auto-WebP compression)',
        tags: ['Tenant Admin Portal'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  photos: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                    description: 'Up to 10 images, max 25MB each',
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'List of compressed WebP image URLs' } },
      },
    },
    '/webhooks/bank/{provider}': {
      post: {
        summary: 'VietQR Bank Transfer Webhook (Idempotent)',
        tags: ['Public Webhooks'],
        parameters: [
          { name: 'provider', in: 'path', required: true, schema: { type: 'string', example: 'sepay' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: '123456789' },
                  amount: { type: 'integer', example: 105000 },
                  content: { type: 'string', example: 'DS-7K3M9Q' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Transaction processed' } },
      },
    },
  },
};

export function setupSwaggerDocs(app: Express) {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { background-color: #15803D; }',
    customSiteTitle: 'Sports Court Booking Platform API Docs',
  }));
}

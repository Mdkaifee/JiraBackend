const swaggerJSDoc = require('swagger-jsdoc');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Jira Backend API',
    version: '1.0.0',
    description: 'Authentication and profile APIs for the Jira clone backend.'
  },
  servers: [
    {
      url: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`,
      description: 'Current environment'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    },
    schemas: {
      BaseResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Operation completed' }
        }
      },
      TokenResponse: {
        allOf: [
          { $ref: '#/components/schemas/BaseResponse' },
          {
            type: 'object',
            properties: {
              token: { type: 'string' }
            }
          }
        ]
      },
      User: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          fullName: { type: 'string' }
        }
      },
      BoardCard: {
        type: 'object',
        properties: {
          title: { type: 'string', example: 'Scrum 1' },
          description: { type: 'string', example: 'Default work item' },
          status: { type: 'string', example: 'To Do' },
          assignee: { type: 'string', nullable: true },
          dueDate: { type: 'string', format: 'date-time' }
        }
      },
      BoardColumn: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'To Do' },
          order: { type: 'integer', example: 1 },
          cards: {
            type: 'array',
            items: { $ref: '#/components/schemas/BoardCard' }
          }
        }
      },
      Project: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['created', 'in-progress', 'completed'] },
          boardType: { type: 'string', enum: ['scrum', 'kanban'] },
          currentSprint: { type: 'string' },
          columns: {
            type: 'array',
            items: { $ref: '#/components/schemas/BoardColumn' }
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' }
        }
      }
    }
  }
};

const options = {
  swaggerDefinition,
  apis: ['./routes/*.js']
};

module.exports = swaggerJSDoc(options);

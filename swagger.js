const swaggerJSDoc = require('swagger-jsdoc');

const port = process.env.PORT || 5000;
const localServerUrl = `http://localhost:${port}`;
const deployedServerUrl =
  process.env.API_BASE_URL ||
  process.env.RENDER_BASE_URL ||
  'https://indianjeera.onrender.com';

const servers = [];

if (deployedServerUrl) {
  servers.push({
    url: deployedServerUrl,
    description: 'Deployed environment'
  });
}

if (!servers.some(server => server.url === localServerUrl)) {
  servers.push({
    url: localServerUrl,
    description: 'Local development'
  });
}

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Jira Backend API',
    version: '1.0.0',
    description: 'Authentication and profile APIs for the Jira clone backend.'
  },
  servers,
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
      ProjectMember: {
        type: 'object',
        properties: {
          user: { type: 'string' },
          role: { type: 'string', enum: ['owner', 'collaborator'] },
          addedBy: { type: 'string' },
          joinedAt: { type: 'string', format: 'date-time' }
        }
      },
      ProjectInviteEntry: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          status: { type: 'string', enum: ['pending', 'accepted', 'cancelled'] },
          invitedBy: { type: 'string' },
          invitedAt: { type: 'string', format: 'date-time' },
          acceptedAt: {
            type: 'string',
            format: 'date-time',
            nullable: true
          }
        }
      },
      ProjectInviteSummary: {
        type: 'object',
        properties: {
          inviteId: { type: 'string' },
          projectId: { type: 'string' },
          projectName: { type: 'string' },
          invitedBy: {
            allOf: [
              { $ref: '#/components/schemas/User' },
              { nullable: true }
            ]
          },
          invitedAt: { type: 'string', format: 'date-time' }
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
          members: {
            type: 'array',
            items: { $ref: '#/components/schemas/ProjectMember' }
          },
          invites: {
            type: 'array',
            items: { $ref: '#/components/schemas/ProjectInviteEntry' }
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

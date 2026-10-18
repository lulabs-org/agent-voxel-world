import swaggerJsdoc from 'swagger-jsdoc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Agent Voxel World API',
      version: '1.0.0',
      description: 'API documentation for Agent Voxel World Server',
    },
    servers: [
      {
        url: 'http://127.0.0.1:2567',
        description: 'Local development server',
      },
    ],
  },
  apis: [path.join(__dirname, 'routes', '*.ts')],
};

export const swaggerSpec = swaggerJsdoc(options);

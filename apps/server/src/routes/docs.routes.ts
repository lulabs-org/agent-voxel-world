import type { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from '../common/swagger';

export function installDocsRoutes(app: Express) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api-docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(swaggerSpec);
  });
}

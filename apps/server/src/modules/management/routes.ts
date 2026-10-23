import type { Express } from 'express';
import { identifier } from '../../common/validation';
import type { ManagementCommands } from './commands';

export function installManagementRoutes(
  app: Express,
  commands: ManagementCommands,
) {
  app.get('/management/commands/:id', (req, res) => {
    if (!identifier(req.params.id)) {
      res.status(400).json({ error: '命令标识无效。' });
      return;
    }
    res.json(commands.get(req.params.id));
  });
}

import { Router } from 'express';
import { database } from '../database/mysql.js';

export const healthRouter = Router();

healthRouter.get('/', (_request, response) => {
  response.status(200).json({
    status: 'ok',
    service: 'sosplus-server',
    timestamp: new Date().toISOString()
  });
});

healthRouter.get('/database', async (_request, response, next) => {
  try {
    const [rows] = await database.query('SELECT DATABASE() AS databaseName, 1 AS connected');
    const result = (rows as Array<{ databaseName: string; connected: number }>)[0];

    response.status(200).json({
      status: 'ok',
      database: result.databaseName,
      connected: Boolean(result.connected)
    });
  } catch (error) {
    next(error);
  }
});

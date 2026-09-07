import express from 'express';
import { healthRouter } from './routes/health.js';

export const app = express();

app.use(express.json());

app.get('/', (_request, response) => {
  response.status(200).json({
    message: 'SOSPlus API está em execução.',
    documentation: '/api/v1/health'
  });
});

app.use('/api/v1/health', healthRouter);

app.use((_request, response) => {
  response.status(404).json({ error: 'Rota não encontrada.' });
});

app.use(
  (
    error: Error,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(error);
    response.status(500).json({ error: 'Erro interno do servidor.' });
  }
);

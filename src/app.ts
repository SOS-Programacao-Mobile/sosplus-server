import express from 'express';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { AuthError } from './auth/validation.js';

export const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.get('/', (_request, response) => {
  response.status(200).json({
    message: 'SOSPlus API está em execução.',
    documentation: '/api/v1/health'
  });
});

app.use('/api/v1/health', healthRouter);
app.use('/api/v1/auth', authRouter);

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
    if (error instanceof AuthError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    if ((error as { type?: string }).type === 'entity.parse.failed') {
      response.status(400).json({ error: 'JSON inválido.' });
      return;
    }
    if ((error as { type?: string }).type === 'entity.too.large') {
      response.status(413).json({ error: 'Requisição muito grande.' });
      return;
    }
    console.error(error);
    response.status(500).json({ error: 'Erro interno do servidor.' });
  }
);

import express from 'express';
import { ongsRouter } from './routes/ongs.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { AuthError } from './auth/validation.js';
import { httpLogger, logError, logWarn } from './observability/logger.js';

export const app = express();

app.disable('x-powered-by');
app.use(httpLogger);
app.use(express.json({ limit: '16kb' }));

app.get('/', (_request, response) => {
  response.status(200).json({
    message: 'SOSPlus API está em execução.',
    documentation: '/api/v1/health'
  });
});

app.use('/api/v1/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/ongs', ongsRouter);

app.use((_request, response) => {
  response.status(404).json({ error: 'Rota não encontrada.' });
});

app.use(
  (
    error: Error,
    request: express.Request,
    response: express.Response,
    _next: express.NextFunction
  ) => {
    if (error instanceof AuthError) {
      logWarn('Operação rejeitada', { metodo: request.method, rota: request.originalUrl, status: error.status, motivo: error.message });
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
    logError('Operação falhou sem tratamento', error, { metodo: request.method, rota: request.originalUrl });
    response.status(500).json({ error: 'Erro interno do servidor.' });
  }
);

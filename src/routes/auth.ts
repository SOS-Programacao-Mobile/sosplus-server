import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { currentUser, login, logout, register } from '../auth/service.js';
import { AuthError } from '../auth/validation.js';

export const authRouter = Router();
const attemptLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' }
});

function bearer(request: Request): string {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '');
  if (!match) throw new AuthError(401, 'Entre na sua conta para continuar.');
  return match[1];
}

authRouter.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
authRouter.post('/register', attemptLimit, async (request, response) => {
  response.status(201).json({ usuario: await register(request.body) });
});
authRouter.post('/login', attemptLimit, async (request, response) => {
  response.json(await login(request.body));
});
authRouter.get('/me', async (request, response) => {
  response.json({ usuario: await currentUser(bearer(request)) });
});
authRouter.post('/logout', async (request, response) => {
  await logout(bearer(request));
  response.sendStatus(204);
});

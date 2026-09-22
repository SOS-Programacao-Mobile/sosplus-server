import { Router, raw, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { currentUser, login, logout, personalData, profilePhoto, register, updatePassword, updatePersonalData, updateProfilePhoto, updateUserLocation } from '../auth/service.js';
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
authRouter.put('/localizacao', async (request, response) => {
  response.json({ usuario: await updateUserLocation(bearer(request), request.body) });
});
authRouter.get('/foto-perfil', async (request, response) => {
  const foto = await profilePhoto(bearer(request));
  if (!foto) {
    response.sendStatus(204);
    return;
  }
  response.set('Cache-Control', 'private, max-age=300');
  response.type(foto.mimeType).send(foto.conteudo);
});
authRouter.put(
  '/foto-perfil',
  raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '1mb' }),
  async (request, response) => {
    await updateProfilePhoto(bearer(request), request.body, request.headers['content-type']);
    response.sendStatus(204);
  }
);
authRouter.put('/senha', async (request, response) => {
  await updatePassword(bearer(request), request.body);
  response.sendStatus(204);
});
authRouter.get('/dados-pessoais', async (request, response) => {
  response.json({ dadosPessoais: await personalData(bearer(request)) });
});
authRouter.put('/dados-pessoais', async (request, response) => {
  response.json(await updatePersonalData(bearer(request), request.body));
});
authRouter.post('/logout', async (request, response) => {
  await logout(bearer(request));
  response.sendStatus(204);
});

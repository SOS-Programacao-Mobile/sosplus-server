import { Router, raw, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { currentUser, login, logout, personalData, profilePhoto, register, updatePassword, updatePersonalData, updateProfilePhoto, updateUserLocation } from '../auth/service.js';
import { sessionToken } from '../auth/session.js';
import { confirmPasswordRecovery, requestPasswordRecovery } from '../auth/recovery.js';

export const authRouter = Router();
authRouter.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
const attemptLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' }
});
const recoveryRequestLimit = rateLimit({ windowMs: 15*60*1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Muitas solicitações. Aguarde 15 minutos e tente novamente.' } });
const recoveryConfirmationLimit = rateLimit({ windowMs: 15*60*1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' } });

authRouter.post('/recuperacao', recoveryRequestLimit, async (request, response) => {
  response.json(await requestPasswordRecovery(request.body));
});
authRouter.post('/recuperacao/confirmar', recoveryConfirmationLimit, async (request, response) => {
  await confirmPasswordRecovery(request.body);
  response.sendStatus(204);
});

authRouter.post('/register', attemptLimit, async (request, response) => {
  response.status(201).json({ usuario: await register(request.body) });
});
authRouter.post('/login', attemptLimit, async (request, response) => {
  response.json(await login(request.body));
});
authRouter.get('/me', async (request, response) => {
  response.json({ usuario: await currentUser(sessionToken(request)) });
});
authRouter.put('/localizacao', async (request, response) => {
  response.json({ usuario: await updateUserLocation(sessionToken(request), request.body) });
});
authRouter.get('/foto-perfil', async (request, response) => {
  const foto = await profilePhoto(sessionToken(request));
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
    await updateProfilePhoto(sessionToken(request), request.body, request.headers['content-type']);
    response.sendStatus(204);
  }
);
authRouter.put('/senha', async (request, response) => {
  await updatePassword(sessionToken(request), request.body);
  response.sendStatus(204);
});
authRouter.get('/dados-pessoais', async (request, response) => {
  response.json({ dadosPessoais: await personalData(sessionToken(request)) });
});
authRouter.put('/dados-pessoais', async (request, response) => {
  response.json(await updatePersonalData(sessionToken(request), request.body));
});
authRouter.post('/logout', async (request, response) => {
  await logout(sessionToken(request));
  response.sendStatus(204);
});

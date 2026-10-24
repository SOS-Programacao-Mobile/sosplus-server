import { Router } from 'express';
import { sessionToken } from '../auth/session.js';
import { categories, mapOngs, myOngProfile, ongAddress, ongCatalog, publicOngProfile, updateOngAddress, updateOngProfile } from '../ongs/service.js';
import { ongDashboard, setFollow } from '../social/service.js';

export const ongsRouter = Router();

ongsRouter.get('/categorias', async (_request, response) => {
  response.json({ resultados: await categories() });
});

ongsRouter.get('/dashboard', async (request, response) => {
  response.json({ dashboard: await ongDashboard(sessionToken(request)) });
});

ongsRouter.get('/perfil', async (request, response) => {
  response.json({ ong: await myOngProfile(sessionToken(request)) });
});

ongsRouter.put('/perfil', async (request, response) => {
  response.json({ ong: await updateOngProfile(sessionToken(request), request.body) });
});

ongsRouter.get('/endereco', async (request, response) => {
  response.json({ endereco: await ongAddress(sessionToken(request)) });
});

ongsRouter.put('/endereco', async (request, response) => {
  response.json({ endereco: await updateOngAddress(sessionToken(request), request.body) });
});

ongsRouter.get('/mapa', async (_request, response) => {
  response.json({ ongs: await mapOngs() });
});

ongsRouter.get('/', async (request, response) => {
  response.json({ ...(await ongCatalog({
    limit: request.query.limite ?? request.query.limit,
    cursor: request.query.continuacao ?? request.query.cursor,
    categoryId: request.query.categoriaId ?? request.query.categoryId,
  })) });
});

ongsRouter.post('/:id/seguir', async (request, response) => {
  response.json(await setFollow(sessionToken(request), request.params.id, true));
});
ongsRouter.put('/:id/seguir', async (request, response) => {
  response.json(await setFollow(sessionToken(request), request.params.id, true));
});

ongsRouter.delete('/:id/seguir', async (request, response) => {
  response.json(await setFollow(sessionToken(request), request.params.id, false));
});

ongsRouter.get('/:id', async (request, response) => {
  const token = request.headers.authorization ? sessionToken(request) : undefined;
  response.json({ ong: await publicOngProfile(request.params.id, token) });
});

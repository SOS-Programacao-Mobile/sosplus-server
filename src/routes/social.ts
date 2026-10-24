import { Router } from 'express';
import { sessionToken } from '../auth/session.js';
import { createPublication, followedFeed, myPublications, ongDashboard, publicationById, setFollow } from '../social/service.js';

export const socialRouter = Router();

socialRouter.get('/feed', async (request, response) => {
  response.json(await followedFeed(sessionToken(request), request.query.continuacao ?? request.query.cursor, request.query.limite ?? request.query.limit));
});
socialRouter.get('/publicacoes/minhas', async (request, response) => {
  response.json({ resultados: await myPublications(sessionToken(request)) });
});
socialRouter.post('/publicacoes', async (request, response) => {
  response.status(201).json({ publicacao: await createPublication(sessionToken(request), request.body) });
});
socialRouter.get('/publicacoes/:id', async (request, response) => {
  response.json({ publicacao: await publicationById(request.params.id) });
});
socialRouter.get('/ongs/dashboard', async (request, response) => {
  response.json({ dashboard: await ongDashboard(sessionToken(request)) });
});

import { Router } from 'express';
import { sessionToken } from '../auth/session.js';
import {
  activeNeeds, changeItemDonationStatus, changeNeedStatus, createItemDonation, createNeed,
  donorItemDonations, incomingItemDonations, itemDonationById, myNeeds, needById,
} from '../materials/service.js';

export const materialsRouter = Router();

materialsRouter.get('/necessidades/minhas', async (request, response) => {
  response.json({ resultados: await myNeeds(sessionToken(request)) });
});
materialsRouter.get('/necessidades', async (request, response) => {
  response.json({ resultados: await activeNeeds({ categoriaId: request.query.categoriaId, cidade: request.query.cidade, estado: request.query.estado }) });
});
materialsRouter.post('/necessidades', async (request, response) => {
  response.status(201).json({ necessidade: await createNeed(sessionToken(request), request.body) });
});
materialsRouter.get('/necessidades/:id', async (request, response) => {
  const token = request.headers.authorization ? sessionToken(request) : undefined;
  response.json({ necessidade: await needById(request.params.id, token) });
});
materialsRouter.patch('/necessidades/:id/status', async (request, response) => {
  response.json({ necessidade: await changeNeedStatus(sessionToken(request), request.params.id, request.body) });
});

materialsRouter.get('/doacoes-itens/recebimentos', async (request, response) => {
  response.json({ resultados: await incomingItemDonations(sessionToken(request)) });
});
materialsRouter.get('/doacoes-itens/minhas', async (request, response) => {
  response.json({ resultados: await donorItemDonations(sessionToken(request)) });
});
materialsRouter.get('/doacoes-itens', async (request, response) => {
  response.json({ resultados: await donorItemDonations(sessionToken(request)) });
});
materialsRouter.post('/doacoes-itens', async (request, response) => {
  response.status(201).json({ doacao: await createItemDonation(sessionToken(request), request.body) });
});
materialsRouter.get('/doacoes-itens/:id', async (request, response) => {
  response.json({ doacao: await itemDonationById(sessionToken(request), request.params.id) });
});
materialsRouter.patch('/doacoes-itens/:id/status', async (request, response) => {
  response.json({ doacao: await changeItemDonationStatus(sessionToken(request), request.params.id, request.body) });
});

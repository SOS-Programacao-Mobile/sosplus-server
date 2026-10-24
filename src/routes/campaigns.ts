import { Router } from 'express';
import { sessionToken } from '../auth/session.js';
import { campaignById, campaigns, changeCampaignStatus, createCampaign, myCampaigns, updateCampaign } from '../campaigns/service.js';

export const campaignsRouter = Router();

campaignsRouter.get('/minhas', async (request, response) => {
  response.json({ resultados: await myCampaigns(sessionToken(request), request.query.status) });
});

campaignsRouter.get('/', async (request, response) => {
  response.json(await campaigns({
    status: request.query.status, cursor: request.query.continuacao ?? request.query.cursor,
    city: request.query.cidade, state: request.query.estado, limit: request.query.limite,
  }));
});

campaignsRouter.post('/', async (request, response) => {
  response.status(201).json({ campanha: await createCampaign(sessionToken(request), request.body) });
});

campaignsRouter.get('/:id', async (request, response) => {
  const token = request.headers.authorization ? sessionToken(request) : undefined;
  response.json({ campanha: await campaignById(request.params.id, token) });
});

campaignsRouter.put('/:id', async (request, response) => {
  response.json({ campanha: await updateCampaign(sessionToken(request), request.params.id, request.body) });
});

campaignsRouter.patch('/:id/status', async (request, response) => {
  response.json({ campanha: await changeCampaignStatus(sessionToken(request), request.params.id, request.body) });
});

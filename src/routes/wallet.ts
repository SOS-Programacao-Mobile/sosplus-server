import { Router } from 'express';
import { sessionToken } from '../auth/session.js';
import { cancelDonation, confirmDonation, createDonation, donation, donations, setWallet, wallet } from '../wallet/service.js';

export const walletRouter = Router();

walletRouter.get('/carteira', async (request, response) => {
  response.json({ carteira: await wallet(sessionToken(request)) });
});

walletRouter.put('/carteira', async (request, response) => {
  response.json({ carteira: await setWallet(sessionToken(request), request.body) });
});

walletRouter.post('/doacoes', async (request, response) => {
  response.status(201).json({ doacao: await createDonation(sessionToken(request), request.body, request.get('Idempotency-Key')) });
});

walletRouter.get('/doacoes', async (request, response) => {
  response.json({ resultados: await donations(sessionToken(request)) });
});

walletRouter.get('/doacoes/:id', async (request, response) => {
  response.json({ doacao: await donation(sessionToken(request), request.params.id) });
});

walletRouter.post('/doacoes/:id/confirmar', async (request, response) => {
  response.json({ doacao: await confirmDonation(sessionToken(request), request.params.id) });
});

walletRouter.post('/doacoes/:id/cancelar', async (request, response) => {
  response.json({ doacao: await cancelDonation(sessionToken(request), request.params.id) });
});

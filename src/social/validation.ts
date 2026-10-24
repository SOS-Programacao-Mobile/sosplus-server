import { AuthError } from '../auth/validation.js';

export function validatePublication(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'Envie o texto da publicação.');
  const body = value as Record<string, unknown>;
  if (typeof body.texto !== 'string' || !body.texto.trim() || body.texto.trim().length > 10000) throw new AuthError(400, 'O texto deve ter de 1 a 10000 caracteres.');
  const campaignId = body.campanhaId === undefined || body.campanhaId === null || body.campanhaId === '' ? null : String(body.campanhaId);
  if (campaignId !== null && !/^\d+$/.test(campaignId)) throw new AuthError(400, 'Campanha inválida.');
  const imageId = body.imagemId === undefined || body.imagemId === null || body.imagemId === '' ? null : String(body.imagemId);
  if (imageId !== null && !/^\d+$/.test(imageId)) throw new AuthError(400, 'Imagem inválida.');
  return { texto: body.texto.trim(), campaignId, imageId };
}

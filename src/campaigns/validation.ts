import { AuthError } from '../auth/validation.js';

const statuses = new Set(['RASCUNHO', 'ATIVA', 'ENCERRADA', 'CANCELADA']);

export function validateCampaign(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'Envie os dados da campanha.');
  const body = value as Record<string, unknown>;
  const titulo = typeof body.titulo === 'string' ? body.titulo.trim() : '';
  const descricao = typeof body.descricao === 'string' ? body.descricao.trim() : '';
  const categoriaId = String(body.categoriaId ?? '');
  const metaCentavos = body.metaCentavos;
  const inicioEm = body.inicioEm;
  const fimEm = body.fimEm;
  if (!titulo || titulo.length > 200 || !descricao || descricao.length > 20_000 || !/^\d+$/.test(categoriaId)) {
    throw new AuthError(400, 'Preencha título, descrição e categoria válidos.');
  }
  if (!Number.isSafeInteger(metaCentavos) || Number(metaCentavos) < 0 || Number(metaCentavos) > 99_999_999_999) {
    throw new AuthError(400, 'A meta deve ser um valor não negativo em centavos.');
  }
  if (!validDate(inicioEm) || !validDate(fimEm) || (fimEm as string) < (inicioEm as string)) {
    throw new AuthError(400, 'Informe um período válido para a campanha.');
  }
  const imagemId = body.imagemId;
  if (imagemId !== undefined && imagemId !== null && (typeof imagemId !== 'string' || !/^\d+$/.test(imagemId))) {
    throw new AuthError(400, 'Imagem inválida.');
  }
  return {
    titulo, descricao, categoriaId, metaCentavos: Number(metaCentavos), inicioEm: inicioEm as string,
    fimEm: fimEm as string, imagemId: imagemId as string | null | undefined,
  };
}

export function validateCampaignStatus(value: unknown): string {
  const status = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).status : undefined;
  if (typeof status !== 'string' || !statuses.has(status)) throw new AuthError(400, 'Status de campanha inválido.');
  return status;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

import { AuthError } from '../auth/validation.js';

export function validateNeed(value: unknown) {
  const body = bodyObject(value);
  const text = (key: string, max: number) => {
    const raw = body[key];
    if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > max) throw new AuthError(400, `Campo ${key} inválido.`);
    return raw.trim();
  };
  const categoryId = String(body.categoriaId ?? '');
  const quantity = decimal(body.quantidade);
  const imageId = optionalImage(body.imagemId);
  if (!/^\d+$/.test(categoryId)) throw new AuthError(400, 'Categoria inválida.');
  return { categoriaId: categoryId, titulo: text('titulo', 200), descricao: text('descricao', 20000),
    tipo: text('tipo', 100), quantidade: quantity, unidade: text('unidade', 50), imagemId: imageId };
}

export function validateItemDonation(value: unknown) {
  const body = bodyObject(value);
  const needId = String(body.necessidadeId ?? '');
  if (!/^\d+$/.test(needId)) throw new AuthError(400, 'Necessidade inválida.');
  if (body.formaEntrega !== 'ENTREGA_NA_ONG' && body.formaEntrega !== 'RETIRADA') throw new AuthError(400, 'Selecione entrega na ONG ou retirada.');
  const observation = optionalText(body.observacao, 5000);
  const date = optionalDate(body.dataEntrega);
  return { needId, quantidade: decimal(body.quantidade), formaEntrega: body.formaEntrega, observacao: observation, dataEntrega: date, imagemId: optionalImage(body.imagemId) };
}

export function validateNeedStatus(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'Informe o estado da necessidade.');
  const status = (value as Record<string, unknown>).status;
  if (status !== 'CANCELADA') throw new AuthError(400, 'Estado de necessidade inválido.');
  return status;
}

export function validateItemStatus(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'Informe o estado da intenção.');
  const body = value as Record<string, unknown>;
  if (!['ACEITA', 'ENTREGUE', 'CANCELADA'].includes(String(body.status))) throw new AuthError(400, 'Estado da intenção inválido.');
  const dataEntrega = optionalDate(body.dataEntrega);
  return { status: String(body.status), dataEntrega };
}

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'Envie os dados da necessidade.');
  return value as Record<string, unknown>;
}
function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) throw new AuthError(400, 'Observação inválida.');
  return value.trim() || null;
}
function optionalImage(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new AuthError(400, 'Imagem inválida.');
  return value;
}
function decimal(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new AuthError(400, 'Informe uma quantidade positiva com até duas casas decimais.');
  const raw = String(value).trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) throw new AuthError(400, 'Informe uma quantidade positiva com até duas casas decimais.');
  const [whole, fraction = ''] = raw.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

function optionalDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new AuthError(400, 'Data de entrega inválida.');
  const [year,month,day] = value.slice(0,10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year,month-1,day));
  if (year < 1000 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month-1 || calendar.getUTCDate() !== day) throw new AuthError(400, 'Data de entrega inválida.');
  return new Date(value);
}

import { AuthError } from '../auth/validation.js';

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'Envie os campos da organização.');
  return value as Record<string, unknown>;
}

function optionalText(body: Record<string, unknown>, key: string, max: number): string | null {
  const value = body[key];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) throw new AuthError(400, `Campo ${key} inválido.`);
  return value.trim() || null;
}

export function validateOngProfile(value: unknown) {
  const body = bodyObject(value);
  const rawCategories = body.categoriaIds;
  if (!Array.isArray(rawCategories) || rawCategories.length === 0 || rawCategories.length > 30 ||
      rawCategories.some((id) => typeof id !== 'string' && typeof id !== 'number')) {
    throw new AuthError(400, 'Selecione pelo menos uma categoria válida.');
  }
  const categoriaIds = [...new Set(rawCategories.map(String))];
  if (categoriaIds.some((id) => !/^\d+$/.test(id))) throw new AuthError(400, 'Categoria inválida.');
  const year = body.anoFundacao;
  const anoFundacao = year === null || year === undefined || year === '' ? null : Number(year);
  if (anoFundacao !== null && (!Number.isInteger(anoFundacao) || anoFundacao < 1800 || anoFundacao > new Date().getFullYear())) {
    throw new AuthError(400, 'Ano de fundação inválido.');
  }
  const imageId = (key: 'fotoPerfil' | 'fotoCapa') => {
    if (!(key in body)) return undefined;
    const value = body[key];
    if (value === null || value === '') return null;
    if (typeof value !== 'string' && typeof value !== 'number') throw new AuthError(400, 'Imagem inválida.');
    const id = String(value);
    if (!/^\d+$/.test(id)) throw new AuthError(400, 'Imagem inválida.');
    return id;
  };
  return {
    descricao: optionalText(body, 'descricao', 5000),
    anoFundacao,
    telefone: optionalText(body, 'telefone', 20),
    site: optionalText(body, 'site', 255),
    instagram: optionalText(body, 'instagram', 255),
    chavePix: optionalText(body, 'chavePix', 255),
    fotoPerfil: imageId('fotoPerfil'),
    fotoCapa: imageId('fotoCapa'),
    categoriaIds,
  };
}

export function validateOngAddress(value: unknown) {
  const body = bodyObject(value);
  const fields = ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'estado'] as const;
  const limits = { cep: 9, logradouro: 255, numero: 20, bairro: 100, cidade: 100, estado: 2 };
  const address = Object.fromEntries(fields.map((field) => {
    const raw = body[field];
    if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > limits[field]) {
      throw new AuthError(400, 'Preencha corretamente o endereço.');
    }
    return [field, raw.trim()];
  })) as Record<(typeof fields)[number], string>;
  const complemento = optionalText(body, 'complemento', 100);
  if (!/^\d{5}-?\d{3}$/.test(address.cep) || !/^[A-Z]{2}$/.test(address.estado)) throw new AuthError(400, 'Confira o CEP e a UF.');
  const lat = body.latitude;
  const lng = body.longitude;
  const noCoordinates = (lat === null || lat === undefined || lat === '') && (lng === null || lng === undefined || lng === '');
  if (!noCoordinates && (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180)) {
    throw new AuthError(400, 'Informe as duas coordenadas válidas ou deixe ambas vazias.');
  }
  return { ...address, complemento, latitude: noCoordinates ? null : lat as number, longitude: noCoordinates ? null : lng as number };
}

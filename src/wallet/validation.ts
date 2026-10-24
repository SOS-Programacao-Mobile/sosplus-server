import { AuthError } from '../auth/validation.js';

export const MAX_CENTS = 99_999_999_999;

export function validateBalance(value: unknown): number {
  const balance = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).saldoCentavos : undefined;
  if (typeof balance !== 'number' || !Number.isSafeInteger(balance) || balance < 0 || balance > MAX_CENTS) {
    throw new AuthError(400, 'Informe um saldo fictício não negativo em centavos, até R$ 999.999.999,99.');
  }
  return balance;
}

export function validateDonation(value: unknown, operationKey: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'Envie os dados da contribuição.');
  const body = value as Record<string, unknown>;
  const campaignId = String(body.campanhaId ?? '');
  const valueCents = body.valorCentavos;
  if (!/^\d+$/.test(campaignId) || typeof valueCents !== 'number' || !Number.isSafeInteger(valueCents) || valueCents < 1 || valueCents > MAX_CENTS) {
    throw new AuthError(400, 'Informe uma campanha e um valor positivo em centavos.');
  }
  if (typeof body.anonima !== 'boolean') throw new AuthError(400, 'Informe se a contribuição será anônima.');
  if (typeof operationKey !== 'string' || operationKey.length < 8 || operationKey.length > 80 || !/^[A-Za-z0-9-]+$/.test(operationKey)) {
    throw new AuthError(400, 'Chave de operação inválida.');
  }
  return { campaignId, valueCents, anonymous: body.anonima, operationKey };
}

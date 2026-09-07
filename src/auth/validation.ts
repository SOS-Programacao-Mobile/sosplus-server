export class AuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export type TipoUsuario = 'DOADOR' | 'ONG';

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthError(400, 'Envie os campos do formulário.');
  }
  return value as Record<string, unknown>;
}

function required(body: Record<string, unknown>, field: string, label: string, max: number, trim = true): string {
  const raw = body[field];
  if (typeof raw !== 'string' || !raw.trim()) throw new AuthError(400, `${label} é obrigatório.`);
  const value = trim ? raw.trim() : raw;
  if (value.length > max) throw new AuthError(400, `${label} deve ter no máximo ${max} caracteres.`);
  return value;
}

function tipo(body: Record<string, unknown>): TipoUsuario {
  if (body.tipo !== 'DOADOR' && body.tipo !== 'ONG') throw new AuthError(400, 'Selecione doador ou ONG.');
  return body.tipo;
}

function email(body: Record<string, unknown>): string {
  const value = required(body, 'email', 'E-mail', 255).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new AuthError(400, 'Digite um e-mail válido.');
  return value;
}

// Receita Federal: os primeiros 12 caracteres podem ser alfanuméricos;
// os dois dígitos verificadores usam módulo 11 e valores ASCII menos 48.
export function normalizeCnpj(value: string): string {
  return value.trim().toUpperCase().replace(/[.\/\-]/g, '');
}

export function validCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value);
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) return false;
  function digit(base: string): string {
    const sum = [...base].reverse().reduce((total, char, i) => total + (char.charCodeAt(0) - 48) * (i % 8 + 2), 0);
    const remainder = sum % 11;
    return String(remainder < 2 ? 0 : 11 - remainder);
  }
  const first = digit(cnpj.slice(0, 12));
  return cnpj.slice(12) === first + digit(cnpj.slice(0, 12) + first);
}

export function validateRegistration(value: unknown) {
  const body = bodyObject(value);
  const profile = tipo(body);
  const nome = required(body, 'nome', 'Nome', profile === 'ONG' ? 200 : 150);
  const address = email(body);
  const senha = required(body, 'senha', 'Senha', 128, false);
  const confirmacao = required(body, 'confirmacaoSenha', 'Confirmação de senha', 128, false);
  if (senha.length < 8) throw new AuthError(400, 'A senha deve ter pelo menos 8 caracteres.');
  if (senha !== confirmacao) throw new AuthError(400, 'As senhas não são iguais.');
  let cnpj: string | null = null;
  if (profile === 'ONG') {
    cnpj = normalizeCnpj(required(body, 'cnpj', 'CNPJ', 18));
    if (!validCnpj(cnpj)) throw new AuthError(400, 'Digite um CNPJ válido.');
  }
  return { tipo: profile, nome, email: address, senha, cnpj };
}

export function validateLogin(value: unknown) {
  const body = bodyObject(value);
  return { tipo: tipo(body), email: email(body), senha: required(body, 'senha', 'Senha', 128, false) };
}

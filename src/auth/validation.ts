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

export function validateUserLocation(value: unknown) {
  const body = bodyObject(value);
  const cidade = required(body, 'cidade', 'Cidade', 100);
  const estado = required(body, 'estado', 'Estado', 100);
  const latitude = body.latitude;
  const longitude = body.longitude;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new AuthError(400, 'Coordenadas inválidas.');
  }
  return { cidade, estado, latitude, longitude };
}

export function validateProfilePhoto(value: unknown, mimeType: unknown) {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > 1024 * 1024) {
    throw new AuthError(400, 'Escolha uma imagem de até 1 MB.');
  }
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp') {
    throw new AuthError(400, 'Use uma imagem JPEG, PNG ou WebP.');
  }

  const jpeg = value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff;
  const png = value.length >= 8 && value.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = value.length >= 12 && value.subarray(0, 4).toString('ascii') === 'RIFF' && value.subarray(8, 12).toString('ascii') === 'WEBP';
  if ((mimeType === 'image/jpeg' && !jpeg) || (mimeType === 'image/png' && !png) || (mimeType === 'image/webp' && !webp)) {
    throw new AuthError(400, 'O conteúdo enviado não é uma imagem válida.');
  }
  return { conteudo: value, mimeType };
}

export function validatePasswordUpdate(value: unknown) {
  const body = bodyObject(value);
  const senhaAtual = required(body, 'senhaAtual', 'Senha atual', 128, false);
  const novaSenha = required(body, 'novaSenha', 'Nova senha', 128, false);
  const confirmacao = required(body, 'confirmacaoSenha', 'Confirmação da nova senha', 128, false);
  if (novaSenha.length < 8) throw new AuthError(400, 'A nova senha deve ter pelo menos 8 caracteres.');
  if (novaSenha !== confirmacao) throw new AuthError(400, 'A confirmação da nova senha não confere.');
  if (novaSenha === senhaAtual) throw new AuthError(400, 'A nova senha deve ser diferente da senha atual.');
  return { senhaAtual, novaSenha };
}

const tiposSanguineos = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const generos = new Set(['MASCULINO', 'FEMININO', 'OUTROS', 'PREFIRO_NAO_INFORMAR']);

function optional(body: Record<string, unknown>, field: string, label: string, max: number): string | null {
  const raw = body[field];
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') throw new AuthError(400, `${label} é inválido.`);
  const value = raw.trim();
  if (!value) return null;
  if (value.length > max) throw new AuthError(400, `${label} deve ter no máximo ${max} caracteres.`);
  return value;
}

export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, '');
}

export function validCpf(value: string): boolean {
  const cpf = normalizeCpf(value);
  if (!/^\d{11}$/.test(cpf) || /^(.)\1{10}$/.test(cpf)) return false;
  const digit = (size: number) => {
    const sum = cpf.slice(0, size).split('').reduce((total, char, index) => total + Number(char) * (size + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export function validatePersonalData(value: unknown) {
  const body = bodyObject(value);
  const nome = required(body, 'nome', 'Nome', 100);
  const sobrenome = optional(body, 'sobrenome', 'Sobrenome', 150);
  const cpfInformado = optional(body, 'cpf', 'CPF', 14);
  const cpf = cpfInformado ? normalizeCpf(cpfInformado) : null;
  if (cpf && !validCpf(cpf)) throw new AuthError(400, 'Digite um CPF válido.');

  const dataNascimento = optional(body, 'dataNascimento', 'Data de nascimento', 10);
  if (dataNascimento) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) throw new AuthError(400, 'Use uma data de nascimento válida.');
    const parsed = new Date(`${dataNascimento}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dataNascimento || parsed >= new Date()) {
      throw new AuthError(400, 'Use uma data de nascimento válida e anterior a hoje.');
    }
  }

  const endereco = optional(body, 'endereco', 'Endereço', 500);
  const telefoneInformado = optional(body, 'telefone', 'Telefone', 25);
  const telefone = telefoneInformado?.replace(/[^\d+]/g, '') ?? null;
  if (telefone && !/^\+?\d{10,15}$/.test(telefone)) throw new AuthError(400, 'Digite um telefone válido com DDD.');

  const tipoSanguineo = optional(body, 'tipoSanguineo', 'Tipo sanguíneo', 3);
  if (tipoSanguineo && !tiposSanguineos.has(tipoSanguineo)) throw new AuthError(400, 'Selecione um tipo sanguíneo válido.');
  const genero = optional(body, 'genero', 'Gênero', 24);
  if (genero && !generos.has(genero)) throw new AuthError(400, 'Selecione uma opção de gênero válida.');

  return { nome, sobrenome, cpf, dataNascimento, endereco, tipoSanguineo, genero, telefone };
}
